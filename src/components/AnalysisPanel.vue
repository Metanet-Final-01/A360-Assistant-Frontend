<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { useUiStore } from "../stores/ui";
import { buildPackageColorMap, numberFlowSteps, violationSetByStep } from "../utils/recommendation";
import { analysisStats, evidenceItems, ioUsage, systemUsage } from "../utils/analysisSummary";
import { evidenceLabel } from "../utils/format";
import { useFitTitle } from "../composables/useFitTitle";
import { useRecommendationExport } from "../composables/useRecommendationExport";
import FlowSequence from "./FlowSequence.vue";
import ScrollThumb from "./ScrollThumb.vue";

// FlowCanvas(vue-flow 전체)는 DOCX 캡처에만 쓰는데 이 패널은 로그인 후 화면마다 항상 뜬다 —
// 정적 임포트하면 흐름도를 한 번도 안 보는 세션에도 vue-flow(200KB+)가 메인 청크에 얹힌다.
// 동적 임포트로 hasDocxFlow가 처음 true가 될 때(=저장된 추천안에 액션이 생겼을 때)만 받아온다.
const FlowCanvas = defineAsyncComponent(() => import("./flow-canvas/FlowCanvas.vue"));

defineOptions({ inheritAttrs: false });

const pipeline = usePipelineStore();
const ui = useUiStore();
const { t } = useI18n();

const titleRef = ref(null);
useFitTitle(titleRef, () => t("recommendDetail.title"));

// 패널 루트 — 국소 수정 중인 단계로 스크롤할 때 그 단계 요소를 여기서 찾는다.
const rootRef = ref(null);

// ─────────────────────────────────────────────────────────────────────────────
// 탭 — 분석 결과(WorkStep)를 다섯 각도로 나눠 보여주고, 마지막 하나가 추천 흐름도
// (RecommendedAction)다. 흐름도 step은 분석 단계와 1:1이 아니므로(에이전트가 자유롭게
// 합치고 쪼갠다) step_id로 매칭하지 않고 각자 자기 데이터만으로 독립 렌더한다.
// ─────────────────────────────────────────────────────────────────────────────
const hasSteps = computed(() => (pipeline.analysis?.steps ?? []).length > 0);

// 스트리밍 중이면 라이브 스냅샷(liveFlow)을, 아니면 저장된 최종 추천안을 소스로 삼는다.
const liveMode = computed(() => pipeline.liveActive);
const activeRec = computed(() =>
  liveMode.value ? pipeline.liveFlow : pipeline.recommendation?.recommendation,
);
const activeSteps = computed(() => activeRec.value?.steps ?? []);
const hasActions = computed(() => activeSteps.value.some((s) => (s.actions?.length ?? 0) > 0));

// 분석 스트리밍 — 백엔드가 분석을 요약→단계 순으로 흘려보내는 라이브 스냅샷.
// 분석이 끝나기 전(analyzing)에 이걸 읽기 전용으로 렌더해 결과가 채워지는 걸 보여준다.
const liveAnalysis = computed(() => pipeline.liveAnalysis);
const liveAnalysisSteps = computed(() => pipeline.liveAnalysis?.steps ?? []);

// 탭별 "보여줄 게 있는지" — 없으면 탭을 비활성으로 두되 자리는 남긴다(탭 줄이 들쭉날쭉하면
// 어떤 관점이 존재하는지 자체가 안 보인다).
const summaryRows = computed(() =>
  hasSteps.value ? pipeline.analysis.steps : liveAnalysisSteps.value,
);
const systems = computed(() => systemUsage(pipeline.analysis?.steps));
const io = computed(() => ioUsage(pipeline.analysis?.steps));
const evidences = computed(() => evidenceItems(pipeline.analysis?.steps));
const stats = computed(() => analysisStats(pipeline.analysis?.steps));

// "단계별 상세"는 분석이 도는 중(아직 라이브 단계가 0개일 수 있다)과 실패 상태(재시도 버튼이
// 이 탭에 있다)에도 열려 있어야 한다 — 단계 개수만으로 판단하면 분석을 시작하자마자 탭이
// 비활성이 되어 아래 자동 전환 watcher가 곧바로 다른 탭으로 튕겨낸다.
const stepsTabAlwaysOpen = computed(
  () => pipeline.analysisStatus === "analyzing" || pipeline.analysisStatus === "error",
);

const TABS = [
  { key: "summary", labelKey: "analysisTabs.summary", available: () => summaryRows.value.length > 0 },
  {
    key: "steps",
    labelKey: "analysisTabs.steps",
    available: () => summaryRows.value.length > 0 || stepsTabAlwaysOpen.value,
  },
  { key: "systems", labelKey: "analysisTabs.systems", available: () => systems.value.length > 0 },
  {
    key: "io",
    labelKey: "analysisTabs.io",
    available: () => io.value.inputs.length > 0 || io.value.outputs.length > 0,
  },
  { key: "evidence", labelKey: "analysisTabs.evidence", available: () => evidences.value.length > 0 },
  {
    key: "flow",
    labelKey: "analysisTabs.flow",
    available: () => hasActions.value || liveMode.value || !!pipeline.recommendation,
  },
];

const tabs = computed(() => TABS.map((tab) => ({ ...tab, enabled: tab.available() })));
const activeTab = computed(() => ui.analysisTab);

function selectTab(key) {
  ui.setAnalysisTab(key);
}

// 지금 탭에 보여줄 게 없어지면(세션 전환·새 문서 업로드 등) 조용히 볼 수 있는 첫 탭으로
// 옮긴다 — 그러지 않으면 데이터가 멀쩡히 있는데도 빈 화면만 남는다.
watch(
  tabs,
  (list) => {
    const current = list.find((tab) => tab.key === activeTab.value);
    if (current?.enabled) return;
    const firstEnabled = list.find((tab) => tab.enabled);
    if (firstEnabled) ui.setAnalysisTab(firstEnabled.key);
  },
  { deep: true },
);

// 분석/흐름도 스트리밍이 시작되면 그 결과가 그려지는 탭으로 자동 전환한다 — 사용자가 다른
// 탭을 보던 중이면 실시간 생성 과정을 통째로 놓친다(예전에는 한 화면이라 늘 보였다).
watch(
  () => pipeline.analysisStatus,
  (status, prev) => {
    if (status === "analyzing") ui.setAnalysisTab("steps");
    else if (status === "done" && prev === "analyzing") ui.setAnalysisTab("summary");
  },
);
watch(
  () => pipeline.liveActive,
  (active) => {
    if (active) ui.setAnalysisTab("flow");
  },
);

// ── 헤더 배지 ──
const hasActiveSession = computed(() => !!pipeline.sessionId);
const flowConfidence = computed(() => activeRec.value?.flow_confidence ?? null);

// ── 헤더 액션(내보내기 · 흐름도 보기) — 예전엔 본문 아래 별도 액션 바(AppActionBar)에
// 있었으나, 신뢰도 배지 옆 헤더로 옮겨 붙였다. 그만큼 아래 패널들의 세로 공간이 남아
// --panel-height(style.css)를 키워 채운다.
const { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx } =
  useRecommendationExport();

const canGoNext = computed(
  () => (pipeline.analysisStatus === "done" && hasSteps.value) || !!pipeline.recommendation,
);
const isGenerating = computed(
  () => pipeline.recommendStatus === "generating" || pipeline.liveActive,
);
// 이 버튼은 상태와 무관하게 "흐름도로 간다"는 하나의 의미다 — 아직 없으면 생성해서 보여주고,
// 이미 있으면 바로 열어 보여준다(goNext). 그래서 라벨도 항상 "흐름도 보기"로 통일한다 — 생성
// 전이라고 "다음"으로 바뀌면 오히려 버튼의 의미가 매번 달라 보인다. 생성 중일 때만 진행 문구로
// 바뀐다.
const nextLabel = computed(() => (isGenerating.value ? t("actionBar.generating") : t("recommendDetail.viewFlow")));

async function goNext() {
  ui.setAnalysisTab("flow");
  if (pipeline.recommendStatus === "done") {
    const url = `/flow-window.html?session=${encodeURIComponent(pipeline.sessionId)}`;
    window.open(url, `a360-flow-${pipeline.sessionId}`, "width=1280,height=860,resizable=yes,noopener");
    return;
  }
  await pipeline.startRecommend();
}

const exportMenuOpen = ref(false);

async function runExport(fn) {
  exportMenuOpen.value = false;
  await fn();
}

// ── DOCX 내보내기 흐름도 이미지 캡처 ──
// 예전엔 flow-window(FlowWindowApp)에서만 가능했던 절차(FlowCanvas.prepareExportPages/
// captureExportPage로 스텝 경계마다 페이지를 잘라 캡처)를 이 패널로 그대로 옮겨 왔다. 다만 이
// 패널의 "추천 흐름도" 탭은 FlowSequence(세로 목록)로 그려서 캡처할 노드 그래프가 없으므로,
// 화면 밖에 숨겨 둔 FlowCanvas 인스턴스(docxCanvasRef, 템플릿 맨 아래)를 캡처 전용으로 둔다 —
// 저장된 추천안(pipeline.recommendation, liveMode 아님)을 소스로 쓴다.
const docxFlowSteps = computed(() => pipeline.recommendation?.recommendation?.steps ?? []);
const hasDocxFlow = computed(() => docxFlowSteps.value.some((s) => (s.actions?.length ?? 0) > 0));
const docxCanvasRef = ref(null);
const exportingDocx = ref(false);

// FlowCanvas는 async component라 hasDocxFlow가 true가 되는 순간 곧바로 마운트되지 않는다 —
// 흐름도가 막 생긴 직후(또는 느린 네트워크에서) 사용자가 바로 DOCX 내보내기를 누르면
// docxCanvasRef가 아직 null이라 이미지가 조용히 누락될 수 있었다(Qodo 리뷰). hasDocxFlow가
// 켜지자마자 청크를 미리 받아 둬서 그 창을 최대한 줄인다 — 실제 마운트(v-if)는 여전히
// 템플릿이 결정하므로 여기서는 프리페치만 한다.
watch(hasDocxFlow, (v) => {
  if (v) import("./flow-canvas/FlowCanvas.vue").catch(() => {});
});

// docxCanvasRef가 채워질 때까지(청크 로딩 + 컴포넌트 마운트) 프레임 단위로 잠깐 기다린다 —
// 위 프리페치로도 못 따라잡을 만큼 빠르게 누르거나 청크 로딩 자체가 실패한 경우, 무한정
// 기다리지 않고 timeoutMs 후 포기해 이미지 없이 진행한다(Qodo 리뷰 — 레이스 컨디션·로딩
// 실패 둘 다 이 타임아웃 하나로 흡수된다).
async function waitForDocxCanvas(timeoutMs = 2000) {
  const start = performance.now();
  while (!docxCanvasRef.value) {
    if (performance.now() - start > timeoutMs) return null;
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return docxCanvasRef.value;
}

// 캡처 실패해도 문서 자체는 계속 내려받아야 하므로 던지지 않고 빈 배열로 이어간다.
// html-to-image도 FlowCanvas처럼 실제로 내보낼 때만 필요해 동적 임포트한다.
async function captureFlowImages() {
  const canvas = await waitForDocxCanvas();
  if (!canvas) return [];
  const blobs = [];
  try {
    const { toBlob } = await import("html-to-image");
    const pageCount = canvas.prepareExportPages() ?? 0;
    for (let i = 0; i < pageCount; i++) {
      const target = await canvas.captureExportPage(i);
      if (!target) continue;
      const blob = await toBlob(target.element, {
        backgroundColor: target.backgroundColor,
        width: target.width,
        height: target.height,
        style: target.style,
      });
      if (blob) blobs.push(blob);
    }
  } catch {
    blobs.length = 0;
  } finally {
    canvas.endExportCapture();
  }
  return blobs;
}

async function exportDocx() {
  exportMenuOpen.value = false;
  if (exportingDocx.value) return;
  exportingDocx.value = true;
  try {
    const flowImageBlobs = hasDocxFlow.value ? await captureFlowImages() : [];
    await downloadDocx(flowImageBlobs);
  } finally {
    exportingDocx.value = false;
  }
}

function closeExportMenu(event) {
  if (!exportMenuOpen.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".panel__header-export")) {
    exportMenuOpen.value = false;
  }
}

function closeExportMenuOnEscape(event) {
  if (exportMenuOpen.value && event.key === "Escape") exportMenuOpen.value = false;
}

// 분석/생성/스트리밍 중이면 "작업 중" — 아직 그릴 것이 없어도 빈 화면 대신 스피너를 보여준다.
const working = computed(
  () => liveMode.value || pipeline.analysisStatus === "analyzing" || pipeline.recommendStatus === "generating",
);
const workingText = computed(() =>
  pipeline.analysisStatus === "analyzing" ? t("recommendDetail.analyzingWork") : t("recommendDetail.composingFlowDetail"),
);

// ── 추천 흐름도 탭 ──
const packageColor = computed(() => buildPackageColorMap(activeSteps.value));
function colorFor(pkg) {
  return packageColor.value.get(pkg || t("common.unspecified")) ?? "#888888";
}

const recVariables = computed(() => activeRec.value?.variables ?? []);
const recInputVars = computed(() => recVariables.value.filter((v) => v.direction === "input"));
const recOutputVars = computed(() => recVariables.value.filter((v) => v.direction === "output"));
const notes = computed(() => activeRec.value?.notes);

const numberedSteps = computed(() => numberFlowSteps(activeSteps.value));
const violationsByStep = computed(() =>
  liveMode.value ? violationSetByStep(pipeline.liveViolations) : new Map(),
);
function stepViolations(stepId) {
  return violationsByStep.value.get(stepId) ?? null;
}
const liveViolationCount = computed(() => pipeline.liveViolations?.length ?? 0);

// 지금 국소 수정 중인 단계(step_id) — 그 단계의 액션 박스를 붉게 강조·깜빡이고 그 위치로
// 스크롤한다. 라이브 스트림 중에만 의미가 있다(최종본에선 null).
const activeStep = computed(() => (liveMode.value ? pipeline.liveActiveStep : null));

watch(activeStep, async (stepId) => {
  if (!stepId) return;
  await nextTick();
  rootRef.value
    ?.querySelector(`[data-step-id="${stepId}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// 정밀화가 정상 완료가 아닐 때만 문구를 낸다. done·running·null은 알릴 것이 없다 —
// "완료했습니다"를 매번 띄우면 소음이고, 사용자가 알아야 하는 건 **덜 다듬어졌다**는 사실뿐이다.
const REFINE_NOTICE_KEYS = {
  cancelled: "recommendDetail.refineCancelled",
  timeout: "recommendDetail.refineTimeout",
  failed: "recommendDetail.refineFailed",
};
const refineNotice = computed(() => {
  const key = REFINE_NOTICE_KEYS[pipeline.refineStatus];
  if (!key) return "";
  return pipeline.refineReason || t(key);
});

// ── v3 품질 루프 진행 카드 (spec/candidates/scorecard 프레임) ──
// v2 백엔드에선 이 값들이 항상 null이라 스트립 자체가 렌더되지 않는다(하위호환).
const liveCandidates = computed(() => pipeline.liveCandidates);
const liveScorecard = computed(() => pipeline.liveScorecard);
const candStatusText = computed(() => ({
  composing: t("recommendDetail.candStatus.composing"),
  verifying: t("recommendDetail.candStatus.verifying"),
  failed: t("recommendDetail.candStatus.failed"),
}));

// ── 질문 카드(needs_input, v3) — 미해소 카드만 보여주고 응답을 fill_cards 턴으로 보낸다 ──
const questionCards = computed(() => (activeRec.value?.needs_input ?? []).filter((c) => !c.resolved));
const cardAnswers = ref({});

// 유효 응답 여부는 '지금 화면의 카드' 응답만으로 판단한다 — 사라진 카드의 잔여 응답이
// 제출 버튼을 살리거나 payload에 섞이지 않게 한다.
const answeredCardIds = computed(() =>
  questionCards.value.filter((c) => {
    const v = cardAnswers.value[c.card_id];
    return v !== "" && v != null && v !== false;
  }),
);
const canSubmitCards = computed(
  () => !liveMode.value && pipeline.fillCardsStatus !== "sending" && answeredCardIds.value.length > 0,
);

watch(questionCards, (cards) => {
  const live = new Set(cards.map((c) => c.card_id));
  for (const id of Object.keys(cardAnswers.value)) {
    if (!live.has(id)) delete cardAnswers.value[id];
  }
});

async function submitCards() {
  const values = {};
  for (const c of answeredCardIds.value) {
    const v = cardAnswers.value[c.card_id];
    values[c.card_id] = c.input_type === "number" ? Number(v) : v;
  }
  if (!Object.keys(values).length) return;
  await pipeline.fillCards(values);
  // 성공했을 때만 비운다 — 실패 시 사용자가 재시도할 수 있게 입력값을 보존한다.
  if (pipeline.fillCardsStatus !== "error") cardAnswers.value = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// "단계별 상세" 탭 — 분석 결과(WorkStep) 확인·편집.
// steps는 pipeline.analysis.steps와 동일한 참조 — splice/push로 직접 수정하면 그대로 반영된다.
// 편집(드래그/수정/삭제/추가)은 우선 메모리에서만 일어나고, 흐름도가 이미 생성돼 있으면
// 아래 "흐름도에 저장" 버튼이 편집 내용을 추천 트리에 투영해 새 버전으로 저장한다
// (pipeline.applyAnalysisEditsToFlow — 제스처마다 저장하면 버전이 폭증하므로 명시 버튼 1회 = 1버전).
// ─────────────────────────────────────────────────────────────────────────────
const steps = computed(() => pipeline.analysis?.steps ?? []);

// 카드 드래그 중 자동 스크롤·순서 계산의 기준 — 실제로 스크롤되는 요소는 탭 콘텐츠가 아니라
// .panel__body다(overflow-y: auto). 여기에 ref를 걸어야 목록 끝으로 끌 때 화면이 따라 내려간다.
const scrollBodyRef = ref(null);
const dragIndex = ref(null);
const dragVisualHidden = ref(false);
const openMenuId = ref(null);
const editingStepId = ref(null);
// "+ 업무 단계 추가"로 막 만든, 아직 한 번도 저장되지 않은 단계의 id — 취소 시 이 id와
// 일치할 때만 지운다(필드 값으로 "빈 초안"을 추측하면, 이름을 안 바꾼 실제 저장된 단계를
// 취소만 눌러도 지워버릴 수 있다).
const draftStepId = ref(null);
const stepForm = ref({
  name: "",
  description: "",
  inputs: "",
  outputs: "",
  systems: "",
  branching: "",
  evidenceSnippet: "",
  evidencePage: null,
});

function toCsv(arr) {
  return (arr ?? []).join(", ");
}

function fromCsv(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renumber() {
  steps.value.forEach((s, idx) => {
    s.order = idx + 1;
  });
}

// 드래그 중 포인터 Y좌표를 추적해 자동 스크롤과 순서 미리보기 계산에 사용한다.
// 네이티브 드래그가 진행되는 동안 브라우저(특히 Chromium)는 requestAnimationFrame을
// 거의 멈춰 버려서(위쪽 스크롤이 유독 버벅였던 원인) rAF 대신 setInterval로 주기적으로 돌린다.
let lastPointerY = null;
let dragIntervalId = null;
const AUTO_SCROLL_ZONE = 60;
const AUTO_SCROLL_MAX_SPEED = 18;
const DRAG_TICK_MS = 16;

// 드래그 시작 시점의 각 카드 위치(패널 콘텐츠 기준 좌표)를 스냅샷으로 고정해 둔다.
// 매 프레임 실제 DOM 위치를 다시 재는 대신 이 고정된 위치와 포인터 좌표만 비교해서
// 목표 인덱스를 계산하기 때문에, 카드가 이미 옮겨져 포인터 아래 다른 카드가 들어와도
// 연쇄적으로 계속 재배치되지 않고 "지나간 카드 하나만" 자리를 바꾸는 식으로 동작한다.
let dragStartSlots = null; // [{ mid }] — 원래 순서 기준, 콘텐츠 좌표계

function captureDragStartSlots() {
  const container = scrollBodyRef.value;
  if (!container) {
    dragStartSlots = null;
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const cards = container.querySelectorAll(".rec-card");
  const slots = Array.from(cards).map((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top - containerRect.top + container.scrollTop;
    return { mid: top + r.height / 2 };
  });
  // 드래그 중인 카드 자신의 원래 슬롯은 목표 인덱스 계산에서 제외한다 — 포함된 채로 두면
  // splice로 카드를 뺀 뒤의 배열 인덱스와 어긋나, 아래로 옮길 때 의도한 자리보다 한 칸
  // 더 내려가 버린다.
  if (dragIndex.value !== null) slots.splice(dragIndex.value, 1);
  dragStartSlots = slots;
}

function trackPointer(event) {
  lastPointerY = event.clientY;
}

function runDragFrame() {
  const el = scrollBodyRef.value;
  if (el && lastPointerY !== null) {
    const rect = el.getBoundingClientRect();

    const distFromTop = lastPointerY - rect.top;
    const distFromBottom = rect.bottom - lastPointerY;
    if (distFromTop < AUTO_SCROLL_ZONE) {
      const intensity = Math.min(1, (AUTO_SCROLL_ZONE - distFromTop) / AUTO_SCROLL_ZONE);
      el.scrollTop -= AUTO_SCROLL_MAX_SPEED * intensity;
    } else if (distFromBottom < AUTO_SCROLL_ZONE) {
      const intensity = Math.min(1, (AUTO_SCROLL_ZONE - distFromBottom) / AUTO_SCROLL_ZONE);
      el.scrollTop += AUTO_SCROLL_MAX_SPEED * intensity;
    }

    if (dragStartSlots && dragIndex.value !== null) {
      const pointerContentY = lastPointerY - rect.top + el.scrollTop;
      let targetIndex = dragStartSlots.findIndex((slot) => pointerContentY < slot.mid);
      // 포인터가 남은 카드들의 중심보다 모두 아래면 맨 끝에 놓겠다는 뜻이다. dragStartSlots는
      // 드래그 중인 카드를 뺀 배열(길이 = steps.length - 1)이라, 끝 자리의 삽입 인덱스는
      // length - 1이 아니라 length다 — 빼면 항상 끝에서 두 번째로 들어가 마지막으로는
      // 옮길 수 없다. 카드가 하나뿐이면 length가 0이라 그대로 0이 되어(= 제자리) 무의미한
      // 재배치도 일어나지 않는다.
      if (targetIndex === -1) targetIndex = dragStartSlots.length;
      if (targetIndex !== dragIndex.value) {
        const list = steps.value;
        const [moved] = list.splice(dragIndex.value, 1);
        list.splice(targetIndex, 0, moved);
        dragIndex.value = targetIndex;
      }
    }
  }
}

function startDragTracking() {
  lastPointerY = null;
  window.addEventListener("dragover", trackPointer);
  if (dragIntervalId === null) {
    dragIntervalId = setInterval(runDragFrame, DRAG_TICK_MS);
  }
}

function stopDragTracking() {
  window.removeEventListener("dragover", trackPointer);
  if (dragIntervalId !== null) {
    clearInterval(dragIntervalId);
    dragIntervalId = null;
  }
  lastPointerY = null;
  dragStartSlots = null;
}

// 드래그 시작 인덱스 — 제자리에 놓은 드래그(순서 불변)를 편집으로 오인하지 않기 위해 기록한다.
let dragStartIndex = null;

function onStepDragStart(idx, event) {
  dragIndex.value = idx;
  dragStartIndex = idx;
  event.dataTransfer.effectAllowed = "move";
  captureDragStartSlots();
  startDragTracking();
  // 브라우저가 커서를 따라다니는 기본 드래그 고스트 이미지를 dragstart 시점의 카드
  // 모습으로 이미 캡처해 둔 뒤라야 하므로, 리스트 안 카드를 숨기는 건 한 틱 늦춰서
  // 적용한다 — 동기적으로(또는 Vue의 다음 tick으로) 바로 숨기면 고스트 이미지까지
  // 투명해져 버려서 드래그 중 아무 것도 안 보이는 것처럼 느껴진다.
  setTimeout(() => {
    dragVisualHidden.value = true;
  }, 0);
}

function onStepDrop(event) {
  event.preventDefault();
}

function onStepDragEnd() {
  if (dragIndex.value !== null && dragStartIndex !== null && dragIndex.value !== dragStartIndex) {
    pipeline.markAnalysisEdited(t("upload.changeSummary.reorder"));
  }
  dragIndex.value = null;
  dragStartIndex = null;
  dragVisualHidden.value = false;
  stopDragTracking();
  renumber();
}

function toggleMenu(stepId, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === stepId ? null : stepId;
}

// window 레벨 리스너로도 쓰이므로 target이 Element라는 보장이 없다 — 아니면 바깥 클릭으로 본다.
function closeMenuOnOutsideClick(event) {
  if (openMenuId.value === null) return;
  const el = event.target instanceof Element ? event.target : null;
  if (!el?.closest(".flow-card__menu-wrap")) openMenuId.value = null;
}

function startEditStep(step) {
  // 다른 단계를 편집하는 중이면 무시한다 — 그대로 두면 stepForm이 통째로 교체돼
  // 저장하지 않은 입력이 조용히 사라진다.
  if (editingStepId.value !== null) return;
  openMenuId.value = null;
  editingStepId.value = step.step_id;
  stepForm.value = {
    name: step.name ?? "",
    description: step.description ?? "",
    inputs: toCsv(step.inputs),
    outputs: toCsv(step.outputs),
    systems: toCsv(step.systems),
    branching: step.branching ?? "",
    evidenceSnippet: step.evidence?.snippet ?? "",
    evidencePage: step.evidence?.page ?? null,
  };
}

function cancelEditStep() {
  // 방금 "+ 업무 단계 추가"로 만든, 아직 한 번도 저장되지 않은 카드일 때만 취소 시 지운다.
  if (editingStepId.value !== null && editingStepId.value === draftStepId.value) {
    const idx = steps.value.findIndex((s) => s.step_id === editingStepId.value);
    if (idx !== -1) {
      steps.value.splice(idx, 1);
      renumber();
    }
  }
  editingStepId.value = null;
}

function saveEditStep() {
  const step = steps.value.find((s) => s.step_id === editingStepId.value);
  if (!step) return;
  step.name = stepForm.value.name.trim() || t("upload.unnamedStep");
  step.description = stepForm.value.description.trim();
  step.inputs = fromCsv(stepForm.value.inputs);
  step.outputs = fromCsv(stepForm.value.outputs);
  step.systems = fromCsv(stepForm.value.systems);
  step.branching = stepForm.value.branching.trim() || null;
  const snippet = stepForm.value.evidenceSnippet.trim();
  const page = stepForm.value.evidencePage;
  // 근거 텍스트를 지워도 페이지 번호(편집 UI에 없는 필드)는 남겨 둔다 — 스니펫만 비우려고
  // 저장했는데 페이지 참조까지 통째로 날아가면 안 된다.
  step.evidence = snippet || page != null ? { page, snippet: snippet || null } : null;
  if (draftStepId.value === editingStepId.value) {
    draftStepId.value = null;
    // 새 단계의 첫 저장 = "단계 추가" — 흐름도 투영 시 이 step은 actions: []로 들어간다
    pipeline.markAnalysisEdited(t("upload.changeSummary.add"));
  } else {
    pipeline.markAnalysisEdited(t("upload.changeSummary.edit"));
  }
  editingStepId.value = null;
}

function removeStep(stepId) {
  openMenuId.value = null;
  if (editingStepId.value === stepId) editingStepId.value = null;
  const idx = steps.value.findIndex((s) => s.step_id === stepId);
  if (idx !== -1) steps.value.splice(idx, 1);
  renumber();
  if (stepId === draftStepId.value) {
    draftStepId.value = null; // 저장된 적 없는 초안 삭제는 편집 전후가 동일 — 더티로 안 잡는다
    return;
  }
  pipeline.markAnalysisEdited(t("upload.changeSummary.remove"));
}

function startAddStep() {
  // 다른 단계를 편집하는 중이면 무시한다 — startEditStep과 동일한 이유.
  if (editingStepId.value !== null) return;
  const list = steps.value;
  const newStep = {
    step_id: crypto.randomUUID(),
    order: list.length + 1,
    name: t("upload.newStepDefaultName"),
    description: "",
    inputs: [],
    outputs: [],
    systems: [],
    branching: null,
    evidence: null,
  };
  list.push(newStep);
  draftStepId.value = newStep.step_id;
  startEditStep(newStep);
}

onBeforeUnmount(stopDragTracking);
onMounted(() => {
  window.addEventListener("pointerdown", closeMenuOnOutsideClick);
  window.addEventListener("pointerdown", closeExportMenu);
  window.addEventListener("keydown", closeExportMenuOnEscape);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeMenuOnOutsideClick);
  window.removeEventListener("pointerdown", closeExportMenu);
  window.removeEventListener("keydown", closeExportMenuOnEscape);
});
</script>

<template>
  <section
    ref="rootRef"
    class="panel panel--wide"
    aria-labelledby="analysis-panel-title"
    data-tour="recommend"
    v-bind="$attrs"
  >
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="analysis-panel-title" ref="titleRef">{{ t("recommendDetail.title") }}</h2>
      <div v-if="hasActiveSession" class="panel__header-actions">
        <span v-if="pipeline.recommendation" class="panel__header-version">
          v{{ pipeline.recommendation.version }}
        </span>
        <span
          v-if="flowConfidence != null"
          class="flow-confidence"
          :class="flowConfidence >= 0.7 ? 'flow-confidence--high' : flowConfidence >= 0.4 ? 'flow-confidence--mid' : 'flow-confidence--low'"
          :title="t('recommendDetail.confidenceTooltip')"
        >
          {{ t("recommendDetail.confidenceLabel") }} {{ Math.round(flowConfidence * 100) }}%
        </span>

        <div class="panel__header-export">
          <button
            type="button"
            class="btn panel__header-btn"
            :disabled="!canExport"
            :title="canExport ? t('recommendDetail.exportTitle') : t('header.exportDisabledHint')"
            :aria-expanded="exportMenuOpen"
            aria-haspopup="menu"
            @click="exportMenuOpen = !exportMenuOpen"
          >
            {{ t("recommendDetail.exportTitle") }}
            <svg
              class="panel__header-chevron"
              :class="{ 'panel__header-chevron--open': exportMenuOpen }"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <Transition name="fade-down">
            <div v-if="exportMenuOpen" class="panel__header-menu" role="menu">
              <button type="button" role="menuitem" class="panel__header-menu-item" @click="runExport(downloadJson)">
                {{ t("recommendDetail.exportJson") }}
              </button>
              <button type="button" role="menuitem" class="panel__header-menu-item" @click="runExport(downloadMarkdown)">
                {{ t("recommendDetail.exportMarkdown") }}
              </button>
              <button
                type="button"
                role="menuitem"
                class="panel__header-menu-item"
                :disabled="exportingDocx"
                @click="exportDocx"
              >
                {{ exportingDocx ? t("recommendDetail.exportingDocx") : t("recommendDetail.exportDocx") }}
              </button>
            </div>
          </Transition>
        </div>

        <button
          type="button"
          class="btn panel__header-btn panel__header-btn--primary"
          :disabled="!canGoNext || isGenerating"
          @click="goNext"
        >
          {{ nextLabel }}
        </button>
      </div>
    </header>

    <!-- 탭 줄 — 흰 배경에 활성 항목만 파란 글씨 + 밑줄. 보여줄 게 없는 탭은 자리를 남긴 채
         비활성으로 둔다(어떤 관점이 존재하는지는 늘 보여야 한다). -->
    <div class="panel-tabs" role="tablist" :aria-label="t('analysisTabs.ariaLabel')" data-tour="analysis">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        class="panel-tabs__tab"
        :class="{ 'panel-tabs__tab--active': activeTab === tab.key }"
        :aria-selected="activeTab === tab.key"
        :disabled="!tab.enabled"
        @click="selectTab(tab.key)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>

    <div class="panel__body scroll-region" ref="scrollBodyRef">
      <p v-if="exportError" class="export-error-banner" role="alert">{{ exportError }}</p>

      <!-- 실시간 생성/수정 상태 배너 — 어느 탭에 있든 보여야 하므로 탭 콘텐츠 바깥에 둔다 -->
      <div v-if="liveMode" class="flow-live-status">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <span class="flow-live-status__caption">{{ pipeline.liveCaption || t("recommendDetail.composingFlow") }}</span>
        <span v-if="liveViolationCount" class="flow-live-status__violations">
          {{ t("recommendDetail.violationCount", { count: liveViolationCount }) }}
        </span>
      </div>

      <!-- 2상 정밀화 배너 (설계 §6.3) — 초안은 이미 화면에 있고, 그 위에서 다듬는 중임을
           알린다. 잠금만 있고 탈출구가 없으면 갇힌 느낌을 주므로 중단 버튼을 함께 둔다.
           liveMode와 독립이다: 스트림이 끝난 뒤 재접속해도(GET /refine 복원) 떠야 한다. -->
      <div v-if="pipeline.draftPending" class="refine-banner">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <span class="refine-banner__text">
          {{ t("recommendDetail.draftReady") }}
          <span v-if="pipeline.refineLocked" class="refine-banner__lock">
            · {{ t("recommendDetail.refineLockedHint") }}
          </span>
        </span>
        <button
          v-if="pipeline.refineLocked"
          type="button"
          class="refine-banner__cancel"
          :disabled="pipeline.isCancellingRefine"
          @click="pipeline.requestRefineCancel()"
        >
          {{ pipeline.isCancellingRefine ? t("recommendDetail.refineCancelling") : t("recommendDetail.refineCancel") }}
        </button>
      </div>

      <div v-if="refineNotice" class="refine-notice">{{ refineNotice }}</div>

      <!-- 과거 세션 로딩 중 -->
      <div v-if="pipeline.sessionLoadStatus === 'loading'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ t("recommendDetail.sessionLoadingHint") }}</p>
      </div>

      <!-- 아직 아무 것도 없고 작업도 안 함 -->
      <div v-else-if="!summaryRows.length && !hasActions && !working" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <p>{{ t("recommendDetail.emptyState") }}</p>
      </div>

      <template v-else>
        <!-- ── 탭 1: 업무 흐름 요약 ── -->
        <div v-if="activeTab === 'summary'" class="tab-pane">
          <p v-if="pipeline.analysis?.summary || summaryRows.length" class="tab-pane__intro">
            {{
              pipeline.analysis?.summary ||
              t("analysisTabs.summaryIntro", { count: summaryRows.length })
            }}
          </p>

          <!-- 단계 흐름 칩 — 좌→우 화살표로 이어지는 요약 뷰 -->
          <ol class="flow-chips">
            <li v-for="(step, idx) in summaryRows" :key="step.step_id ?? idx" class="flow-chips__item">
              <div class="flow-chip">
                <span class="flow-chip__num">{{ step.order ?? idx + 1 }}</span>
                <span class="flow-chip__label" :title="step.name">{{ step.name }}</span>
              </div>
              <span v-if="idx < summaryRows.length - 1" class="flow-chips__arrow" aria-hidden="true">→</span>
            </li>
          </ol>

          <h4 class="tab-pane__section-title">{{ t("analysisTabs.stepTableTitle") }}</h4>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col" class="data-table__col-num">{{ t("analysisTabs.col.order") }}</th>
                  <th scope="col">{{ t("analysisTabs.col.name") }}</th>
                  <th scope="col">{{ t("analysisTabs.col.description") }}</th>
                  <th scope="col">{{ t("analysisTabs.col.inputs") }}</th>
                  <th scope="col">{{ t("analysisTabs.col.outputs") }}</th>
                  <th scope="col">{{ t("analysisTabs.col.systems") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(step, idx) in summaryRows" :key="step.step_id ?? idx">
                  <td class="data-table__col-num">{{ step.order ?? idx + 1 }}</td>
                  <td class="data-table__cell--strong">{{ step.name }}</td>
                  <td>{{ step.description || "—" }}</td>
                  <td>{{ step.inputs?.join(", ") || "—" }}</td>
                  <td>{{ step.outputs?.join(", ") || "—" }}</td>
                  <td>{{ step.systems?.join(", ") || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="pipeline.analysis?.ambiguities?.length" class="tab-pane__note">
            <strong>{{ t("analysisTabs.ambiguitiesTitle") }}</strong>
          </p>
          <ul v-if="pipeline.analysis?.ambiguities?.length" class="bullet-list">
            <li v-for="(item, idx) in pipeline.analysis.ambiguities" :key="idx">{{ item }}</li>
          </ul>
        </div>

        <!-- ── 탭 2: 단계별 상세 (확인 · 편집) ── -->
        <div v-else-if="activeTab === 'steps'" class="tab-pane">
          <!-- 분석 중: 스트리밍 렌더(요약 → 단계 하나씩). 첫 프레임 전엔 스피너 -->
          <template v-if="pipeline.analysisStatus === 'analyzing'">
            <div v-if="liveAnalysis" class="analysis-live">
              <TransitionGroup name="rec-list" tag="div" class="rec-list">
                <article
                  v-for="(step, idx) in liveAnalysisSteps"
                  :key="step.step_id ?? idx"
                  class="rec-card rec-card--live"
                >
                  <header class="rec-card__header">
                    <div class="rec-card__header-left">
                      <h3>{{ step.order ?? idx + 1 }}. {{ step.name }}</h3>
                    </div>
                  </header>
                  <p v-if="step.description" class="rec-card__description">{{ step.description }}</p>
                </article>
              </TransitionGroup>
            </div>
            <div v-else class="analyzing-state">
              <span class="analyzing-state__spinner" aria-hidden="true"></span>
              <p>{{ t("upload.analyzingHint") }}</p>
            </div>
          </template>

          <div v-else-if="pipeline.analysisStatus === 'error'" class="analyzing-state analyzing-state--error">
            <p class="upload-error">{{ pipeline.analysisError }}</p>
            <button type="button" class="btn btn--outline" @click="pipeline.startAnalysis">{{ t("upload.retry") }}</button>
          </div>

          <template v-else>
            <div v-if="!hasSteps" class="empty-state">
              <p>{{ t("upload.noStepsFound") }}</p>
            </div>

            <TransitionGroup name="rec-list" tag="div" class="rec-list" @dragover.prevent @drop="onStepDrop">
              <article
                v-for="(step, idx) in steps"
                :key="step.step_id"
                class="rec-card"
                :class="{ 'rec-card--dragging': dragVisualHidden && dragIndex === idx }"
                draggable="true"
                @dragstart="onStepDragStart(idx, $event)"
                @dragend="onStepDragEnd"
                @click="closeMenuOnOutsideClick"
              >
                <template v-if="editingStepId === step.step_id">
                  <div class="flow-card__edit-grid">
                    <label class="flow-card__edit-wide">
                      <span>{{ t("upload.form.title") }}</span>
                      <input v-model="stepForm.name" type="text" />
                    </label>
                    <label class="flow-card__edit-wide">
                      <span>{{ t("upload.form.description") }}</span>
                      <input v-model="stepForm.description" type="text" />
                    </label>
                    <label>
                      <span>{{ t("upload.form.inputsCsv") }}</span>
                      <input v-model="stepForm.inputs" type="text" />
                    </label>
                    <label>
                      <span>{{ t("upload.form.outputsCsv") }}</span>
                      <input v-model="stepForm.outputs" type="text" />
                    </label>
                    <label>
                      <span>{{ t("upload.form.systemsCsv") }}</span>
                      <input v-model="stepForm.systems" type="text" />
                    </label>
                    <label>
                      <span>{{ t("upload.form.branching") }}</span>
                      <input v-model="stepForm.branching" type="text" />
                    </label>
                    <label class="flow-card__edit-wide">
                      <span>{{ t("upload.form.evidence") }}</span>
                      <input v-model="stepForm.evidenceSnippet" type="text" />
                    </label>
                  </div>
                  <div class="flow-card__actions">
                    <button type="button" class="btn btn--outline" @click="cancelEditStep">{{ t("common.cancel") }}</button>
                    <button type="button" class="btn btn--primary" @click="saveEditStep">{{ t("common.save") }}</button>
                  </div>
                </template>

                <template v-else>
                  <header class="rec-card__header">
                    <div class="rec-card__header-left">
                      <span class="flow-card__handle" aria-hidden="true" :title="t('upload.reorderTitle')">⠿</span>
                      <h3>{{ step.order }}. {{ step.name }}</h3>
                    </div>
                    <div class="flow-card__menu-wrap">
                      <button
                        type="button"
                        class="flow-card__menu-btn"
                        :aria-label="t('upload.stepOptionsAria')"
                        @click="toggleMenu(step.step_id, $event)"
                      >
                        &#8942;
                      </button>
                      <Transition name="fade-up">
                        <div v-if="openMenuId === step.step_id" class="flow-card__menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            :disabled="editingStepId !== null"
                            @click="startEditStep(step)"
                          >
                            {{ t("common.edit") }}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            class="flow-card__menu-danger"
                            @click="removeStep(step.step_id)"
                          >
                            {{ t("common.delete") }}
                          </button>
                        </div>
                      </Transition>
                    </div>
                  </header>

                  <p class="rec-card__description">{{ step.description }}</p>

                  <div class="rec-card__grid">
                    <div class="rec-card__field">
                      <span class="rec-card__field-label">{{ t("upload.field.inputs") }}</span>
                      <span class="rec-card__field-value">{{ step.inputs?.join(", ") || t("common.none") }}</span>
                    </div>
                    <div class="rec-card__field">
                      <span class="rec-card__field-label">{{ t("upload.field.outputs") }}</span>
                      <span class="rec-card__field-value">{{ step.outputs?.join(", ") || t("common.none") }}</span>
                    </div>
                    <div class="rec-card__field">
                      <span class="rec-card__field-label">{{ t("upload.field.systems") }}</span>
                      <span class="rec-card__field-value">{{ step.systems?.join(", ") || t("common.none") }}</span>
                    </div>
                    <div class="rec-card__field" v-if="step.branching">
                      <span class="rec-card__field-label">{{ t("upload.field.branching") }}</span>
                      <span class="rec-card__field-value">{{ step.branching }}</span>
                    </div>
                  </div>

                  <footer v-if="step.evidence" class="rec-card__footer">
                    {{ t("upload.evidencePrefix", { evidence: evidenceLabel(step.evidence) }) }}
                  </footer>
                </template>
              </article>
            </TransitionGroup>

            <button type="button" class="flow-add-btn" :disabled="editingStepId !== null" @click="startAddStep">
              {{ t("upload.addStep") }}
            </button>

            <!-- 편집을 흐름도 새 버전으로 저장 — 흐름도가 이미 생성된 뒤에만 의미가 있다.
                 제스처마다 자동 저장하지 않고 명시 버튼 1회 = 1버전 (버전 이력이 의도 단위로 남는다) -->
            <div v-if="pipeline.recommendation" class="apply-flow-bar">
              <button
                type="button"
                class="btn btn--primary"
                :disabled="!pipeline.analysisEditsDirty || pipeline.isSavingAnalysisEdits || editingStepId !== null"
                :title="pipeline.analysisEditsDirty ? '' : t('upload.applyToFlowDisabledHint')"
                @click="pipeline.applyAnalysisEditsToFlow"
              >
                {{ pipeline.isSavingAnalysisEdits ? t("upload.applyingToFlow") : t("upload.applyToFlow") }}
              </button>
              <span v-if="pipeline.analysisEditsDirty" class="apply-flow-bar__hint">
                {{ t("upload.unsavedEditsHint") }}
              </span>
            </div>
          </template>
        </div>

        <!-- ── 탭 3: 시스템 · 외부 연계 ── -->
        <div v-else-if="activeTab === 'systems'" class="tab-pane">
          <p class="tab-pane__intro">{{ t("analysisTabs.systemsIntro", { count: stats.systemCount }) }}</p>
          <div class="entity-grid">
            <article v-for="system in systems" :key="system.name" class="entity-card">
              <h4 class="entity-card__title">{{ system.name }}</h4>
              <p class="entity-card__meta">
                {{ t("analysisTabs.usedInSteps", { count: system.usedIn.length }) }}
              </p>
              <ul class="entity-card__steps">
                <li v-for="use in system.usedIn" :key="`${system.name}-${use.order}`">
                  <span class="entity-card__step-num">{{ use.order }}</span>{{ use.name }}
                </li>
              </ul>
            </article>
          </div>
        </div>

        <!-- ── 탭 4: 입력 · 출력 항목 ── -->
        <div v-else-if="activeTab === 'io'" class="tab-pane">
          <div class="io-columns">
            <section class="io-columns__col">
              <h4 class="tab-pane__section-title">
                {{ t("analysisTabs.inputsTitle") }} <span class="tab-pane__count">{{ io.inputs.length }}</span>
              </h4>
              <ul class="entity-list">
                <li v-for="item in io.inputs" :key="`in-${item.name}`" class="entity-list__item">
                  <span class="entity-list__name">{{ item.name }}</span>
                  <span class="entity-list__steps">
                    {{ item.usedIn.map((u) => u.order).join(", ") }}
                  </span>
                </li>
                <li v-if="!io.inputs.length" class="entity-list__empty">{{ t("common.none") }}</li>
              </ul>
            </section>
            <section class="io-columns__col">
              <h4 class="tab-pane__section-title">
                {{ t("analysisTabs.outputsTitle") }} <span class="tab-pane__count">{{ io.outputs.length }}</span>
              </h4>
              <ul class="entity-list">
                <li v-for="item in io.outputs" :key="`out-${item.name}`" class="entity-list__item">
                  <span class="entity-list__name">{{ item.name }}</span>
                  <span class="entity-list__steps">
                    {{ item.usedIn.map((u) => u.order).join(", ") }}
                  </span>
                </li>
                <li v-if="!io.outputs.length" class="entity-list__empty">{{ t("common.none") }}</li>
              </ul>
            </section>
          </div>
          <p class="tab-pane__note">{{ t("analysisTabs.ioStepHint") }}</p>
        </div>

        <!-- ── 탭 5: 원문 근거 ── -->
        <div v-else-if="activeTab === 'evidence'" class="tab-pane">
          <p class="tab-pane__intro">{{ t("analysisTabs.evidenceIntro", { count: evidences.length }) }}</p>
          <ul class="evidence-list">
            <li v-for="item in evidences" :key="`ev-${item.order}`" class="evidence-list__item">
              <div class="evidence-list__head">
                <span class="evidence-list__num">{{ item.order }}</span>
                <span class="evidence-list__name">{{ item.name }}</span>
                <span v-if="item.page != null" class="evidence-list__page">p.{{ item.page }}</span>
              </div>
              <blockquote v-if="item.snippet" class="evidence-list__quote">{{ item.snippet }}</blockquote>
            </li>
          </ul>
        </div>

        <!-- ── 탭 6: 추천 흐름도 ── -->
        <div v-else-if="activeTab === 'flow'" class="tab-pane">
          <!-- v3 품질 루프 진행 스트립 — 후보 카드(트리는 초안 확정 후에만) · 검증 요약 -->
          <div v-if="liveMode && (liveCandidates || liveScorecard)" class="flow-quality-strip">
            <div v-if="liveCandidates" class="flow-quality-strip__cands">
              <span
                v-for="c in liveCandidates"
                :key="c.id"
                class="quality-cand"
                :class="`quality-cand--${c.status}`"
              >
                <strong>{{ c.persona }}</strong>
                <em>{{ candStatusText[c.status] ?? t("recommendDetail.candStepActions", { steps: c.steps, actions: c.actions }) }}</em>
              </span>
            </div>
            <p v-if="liveScorecard" class="quality-scorecard">
              {{ t("recommendDetail.mustCoverageLabel") }}
              {{ liveScorecard.must_coverage != null ? Math.round(liveScorecard.must_coverage * 100) + "%" : "—" }}
              · {{ t("recommendDetail.blockersLabel", { count: liveScorecard.blockers ?? 0 }) }}
              · {{ t("recommendDetail.questionCardsLabel", { count: liveScorecard.cards ?? 0 }) }}
              <template v-if="liveScorecard.flow_confidence != null">
                · {{ t("recommendDetail.flowConfidenceLabel", { percent: Math.round(liveScorecard.flow_confidence * 100) }) }}
              </template>
            </p>
          </div>

          <div v-if="!hasActions && working" class="analyzing-state">
            <span class="analyzing-state__spinner" aria-hidden="true"></span>
            <p>{{ workingText }}</p>
          </div>

          <div v-else-if="!hasActions" class="empty-state">
            <p>{{ t("recommendDetail.emptyState") }}</p>
          </div>

          <div v-else class="rec-detail">
            <div v-if="recInputVars.length || recOutputVars.length" class="rec-detail__vars">
              <div v-if="recInputVars.length" class="rec-detail__var-group">
                <h4>{{ t("recommendDetail.inputVars") }}</h4>
                <ul>
                  <li v-for="v in recInputVars" :key="v.name">
                    <strong>{{ v.name }}</strong>
                    <span class="rec-detail__var-type">{{ v.type }}</span>
                    <span v-if="v.description"> — {{ v.description }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="recOutputVars.length" class="rec-detail__var-group">
                <h4>{{ t("recommendDetail.outputVars") }}</h4>
                <ul>
                  <li v-for="v in recOutputVars" :key="v.name">
                    <strong>{{ v.name }}</strong>
                    <span class="rec-detail__var-type">{{ v.type }}</span>
                    <span v-if="v.description"> — {{ v.description }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div
              v-for="step in numberedSteps"
              :key="step.key"
              class="rec-detail__step"
              :class="{ 'rec-detail__step--editing': step.step_id === activeStep }"
              :data-step-id="step.step_id"
            >
              <h4 class="rec-detail__step-title">{{ step.title }}</h4>
              <p v-if="step.description" class="rec-detail__step-desc">{{ step.description }}</p>

              <FlowSequence
                v-if="step.items.length"
                :items="step.items"
                :color-for="colorFor"
                :violation-paths="stepViolations(step.step_id)"
                :editing="step.step_id === activeStep"
                detailed
              />
              <p v-else class="flow-step-empty">{{ t("recommendDetail.stepNoActions") }}</p>
            </div>

            <p v-if="notes" class="flow-notes"><strong>{{ t("common.notesLabel") }}</strong> {{ notes }}</p>

            <!-- 질문 카드(v3) — 흐름도는 완성 상태이고, 카드는 시안값 확인/빈칸 채움 요청이다 -->
            <div v-if="!liveMode && questionCards.length" class="question-cards">
              <h4 class="question-cards__title">
                {{ t("recommendDetail.questionsNeededTitle") }} <span class="question-cards__count">{{ questionCards.length }}</span>
              </h4>
              <div
                v-for="card in questionCards"
                :key="card.card_id"
                class="question-card"
                :class="{ 'question-card--blocking': card.blocking }"
              >
                <p :id="`q-label-${card.card_id}`" class="question-card__q">
                  {{ card.question }}
                  <span v-if="card.blocking" class="question-card__badge">{{ t("recommendDetail.requiredBadge") }}</span>
                </p>
                <p v-if="card.why" class="question-card__why">{{ card.why }}</p>
                <select
                  v-if="card.input_type === 'select'"
                  v-model="cardAnswers[card.card_id]"
                  class="question-card__input"
                  :aria-labelledby="`q-label-${card.card_id}`"
                >
                  <option value="" disabled>{{ t("recommendDetail.selectPlaceholder") }}</option>
                  <option v-for="opt in card.options || []" :key="String(opt)" :value="opt">{{ opt }}</option>
                </select>
                <label v-else-if="card.input_type === 'confirm'" class="question-card__confirm">
                  <input v-model="cardAnswers[card.card_id]" type="checkbox" />
                  {{ t("recommendDetail.confirmPremise") }}
                </label>
                <input
                  v-else
                  v-model="cardAnswers[card.card_id]"
                  :type="card.input_type === 'number' ? 'number' : 'text'"
                  class="question-card__input"
                  :aria-labelledby="`q-label-${card.card_id}`"
                  :placeholder="card.default != null ? t('recommendDetail.defaultValuePlaceholder', { default: card.default }) : t('recommendDetail.valuePlaceholder')"
                />
              </div>
              <button
                type="button"
                class="btn btn--primary question-cards__submit"
                :disabled="!canSubmitCards"
                @click="submitCards"
              >
                {{ pipeline.fillCardsStatus === "sending" ? t("recommendDetail.submittingCards") : t("recommendDetail.submitCards") }}
              </button>
            </div>
          </div>
        </div>
      </template>
      <ScrollThumb :target="scrollBodyRef" />
    </div>

    <div
      v-if="pipeline.recommendStatus === 'error' || pipeline.recommendSaveError"
      class="panel__footer panel__footer--errors"
    >
      <p v-if="pipeline.recommendStatus === 'error'" class="upload-error">{{ pipeline.recommendError }}</p>
      <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>
    </div>

    <!-- DOCX 내보내기 전용 캡처 캔버스 — 이 패널의 "추천 흐름도" 탭은 FlowSequence(세로 목록)로
         그리지만, DOCX엔 flow-window와 같은 노드 그래프 이미지가 실려야 한다. 화면 밖으로
         밀어 두되 display:none/visibility:hidden은 쓰지 않는다 — html-to-image가 캡처하는
         .vue-flow__transformationpane가 상속으로 같이 숨겨지면 빈 이미지가 찍힌다. -->
    <div v-if="hasDocxFlow" class="panel__docx-capture" aria-hidden="true">
      <FlowCanvas ref="docxCanvasRef" :steps="docxFlowSteps" :editable="false" />
    </div>
  </section>
</template>
