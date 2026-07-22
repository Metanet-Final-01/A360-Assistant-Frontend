<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport } from "../api/recommend";
import { buildPackageColorMap, numberFlowSteps, violationSetByStep } from "../utils/recommendation";
import { recommendationToMarkdown, recommendationToDocxBlob } from "../utils/exportFlow";
import { triggerBlobDownload } from "../utils/download";
import { useFitTitle } from "../composables/useFitTitle";
import FlowSequence from "./FlowSequence.vue";

defineOptions({ inheritAttrs: false });

const pipeline = usePipelineStore();
const { t } = useI18n();

const titleRef = ref(null);
useFitTitle(titleRef, () => t("recommendDetail.title"));

// 패널 루트 — 국소 수정 중인 단계로 스크롤할 때 그 단계 요소를 여기서 찾는다.
const rootRef = ref(null);

// 업무 단계(WorkStep, schemas/analysis.py) 확인·편집은 업로드 패널로 옮겨졌다 — 여기는
// 흐름도(RecommendedAction, schemas/recommendation.py)만 다룬다. 흐름도 step은 분석 단계와
// 1:1이 아니므로(에이전트가 자유롭게 합치고 쪼갠다), step_id로 분석 결과와 매칭하지 않고
// 흐름도 데이터만으로 독립적으로 렌더한다.
const hasSteps = computed(() => (pipeline.analysis?.steps ?? []).length > 0);
// "흐름도 보기"/"JSON 내보내기" 버튼(타이틀 우측)이 활성화될지: 분석이 단계를 찾아 새로 생성할 수
// 있거나(hasSteps), 텍스트 업로드처럼 분석이 단계를 못 찾았어도 챗봇 대화(예: "분석해서 흐름도까지
// 만들어줘")로 이미 흐름도가 만들어져 있으면(pipeline.recommendation) 활성화한다 — 이 경우
// analysisStatus/hasSteps만으로는 판단할 수 없다.
const canUseFlowActions = computed(
  () => (pipeline.analysisStatus === "done" && hasSteps.value) || !!pipeline.recommendation,
);

// 버튼 자체를 보여줄지: sessionId가 있으면(새 문서를 업로드했거나 이력에서 과거 세션을 불러온
// 경우) 보여준다 — "새 채팅"으로 막 들어와 아직 아무 것도 업로드하지 않은 순간에만 sessionId가
// null이라 숨겨진다. loadSession이 과거 세션의 analysisStatus/recommendation을 늦게 채우는
// 동안(로딩 중)에도 버튼이 사라졌다 나타나는 깜빡임 없이 그대로 보이고, 활성화 여부만
// canUseFlowActions로 갈린다.
const hasActiveSession = computed(() => !!pipeline.sessionId);

// 스트리밍 중이면 라이브 스냅샷(liveFlow)을, 아니면 저장된 최종 추천안을 소스로 삼는다 —
// 이 패널이 흐름도 생성/수정 과정을 실시간으로, 완료 후 최종본을 "같은 자리"에서 보여준다.
// (모달 팝업 대신 인라인 스트리밍) 흐름도 step은 분석(WorkStep)과 1:1이 아니라 흐름도
// 데이터(steps→actions→children)만으로 독립 렌더한다.
const liveMode = computed(() => pipeline.liveActive);
const activeRec = computed(() =>
  liveMode.value ? pipeline.liveFlow : pipeline.recommendation?.recommendation,
);
const activeSteps = computed(() => activeRec.value?.steps ?? []);
const hasActions = computed(() => activeSteps.value.some((s) => (s.actions?.length ?? 0) > 0));

// 분석/생성/스트리밍 중이면 "작업 중" — 아직 그릴 액션이 없어도 빈 화면 대신 스피너를 보여준다.
const working = computed(
  () => liveMode.value || pipeline.analysisStatus === "analyzing" || pipeline.recommendStatus === "generating",
);
const workingText = computed(() =>
  pipeline.analysisStatus === "analyzing" ? t("recommendDetail.analyzingWork") : t("recommendDetail.composingFlowDetail"),
);

const packageColor = computed(() => buildPackageColorMap(activeSteps.value));
function colorFor(pkg) {
  return packageColor.value.get(pkg || t("common.unspecified")) ?? "#888888";
}

const recVariables = computed(() => activeRec.value?.variables ?? []);
const inputVars = computed(() => recVariables.value.filter((v) => v.direction === "input"));
const outputVars = computed(() => recVariables.value.filter((v) => v.direction === "output"));
const notes = computed(() => activeRec.value?.notes);

// 트리 렌더용 정규화(모달과 동일한 번호·경로 헬퍼) + 스트리밍 중 검수 위반 노드 강조.
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

// 수정 중인 단계가 바뀌면 그 단계로 부드럽게 스크롤한다 — 사용자가 "지금 어디를 고치는지"
// 눈으로 따라가게. 프레임 반영(트리 재렌더) 후 DOM이 갱신되도록 nextTick을 기다린다.
watch(activeStep, async (stepId) => {
  if (!stepId) return;
  await nextTick();
  rootRef.value
    ?.querySelector(`[data-step-id="${stepId}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// "흐름도 보기" 버튼: 이미 있으면 별도 브라우저 창(flow-window.html)으로 열고, 없으면 생성한다 —
// 생성 과정은 이 패널이 인라인으로 실시간 렌더하므로 별도 로딩 화면을 띄우지 않는다.
async function openFlowView() {
  if (pipeline.recommendStatus === "done") {
    openFlowWindow();
    return;
  }
  await pipeline.startRecommend();
}

// 인앱 모달 대신 진짜 별도 창으로 연다 — Fullscreen API 없이도 OS 창 컨트롤(최대화/최소화/
// 이동/크기조절)을 자유롭게 쓸 수 있다. 세션당 창 이름을 고정해 두 번째 클릭은 새 창 대신
// 기존 창을 포커스한다(브라우저 표준 동작, noopener라 JS 참조로 재사용하는 게 아니다).
function openFlowWindow() {
  const url = `/flow-window.html?session=${encodeURIComponent(pipeline.sessionId)}`;
  window.open(url, `a360-flow-${pipeline.sessionId}`, "width=1280,height=860,resizable=yes,noopener");
}

// 내보내기는 프론트 로컬 Blob이 아니라 백엔드 표준 export API 응답을 그대로 저장한다
// (P1-3 — schema_version 포함 봉투, 골든셋 채점 포맷과 일치). 추천안 버전이 있어야 가능.
const exportError = ref("");
const canExport = computed(() => !!pipeline.sessionId && pipeline.recommendation?.version != null);

// 내보내기 드롭다운 (챗봇 에이전트 버전 선택 드롭다운과 동일한 UX) — 헤더 바로 아래로 펼친다.
const exportMenuOpen = ref(false);

function closeExportMenuOnOutsideClick(event) {
  // window 레벨 리스너라 target이 항상 Element라는 보장이 없다(Qodo 리뷰) — 텍스트 노드 등
  // Element가 아니면 closest 자체가 없어 그냥 바깥 클릭으로 취급해 닫는다.
  if (!exportMenuOpen.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".export-dd")) {
    exportMenuOpen.value = false;
  }
}
function closeExportMenuOnEscape(event) {
  if (exportMenuOpen.value && event.key === "Escape") {
    exportMenuOpen.value = false;
  }
}
onMounted(() => {
  window.addEventListener("pointerdown", closeExportMenuOnOutsideClick);
  window.addEventListener("keydown", closeExportMenuOnEscape);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeExportMenuOnOutsideClick);
  window.removeEventListener("keydown", closeExportMenuOnEscape);
});

async function downloadJson() {
  exportMenuOpen.value = false;
  if (!canExport.value) return;
  exportError.value = "";
  try {
    await downloadRecommendationExport(pipeline.sessionId, pipeline.recommendation.version);
  } catch (err) {
    exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
  }
}

// Markdown/DOCX는 백엔드 export API가 안 주는 문서 형식이라 클라이언트에서 직접 조립한다
// (JSON은 위처럼 채점 포맷 그대로 저장해야 하지만, 문서는 그럴 필요가 없다).
const exportFilenameBase = computed(() => {
  const version = pipeline.recommendation?.version;
  return `recommendation-${pipeline.sessionId}${version != null ? `-v${version}` : ""}`;
});

function downloadMarkdown() {
  exportMenuOpen.value = false;
  if (!canExport.value) return;
  exportError.value = "";
  try {
    const md = recommendationToMarkdown(pipeline.recommendation.recommendation, {
      documentTitle: pipeline.analysis?.document_title,
    });
    triggerBlobDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${exportFilenameBase.value}.md`);
  } catch {
    exportError.value = t("recommendDetail.errors.exportFailed");
  }
}

async function downloadDocx() {
  exportMenuOpen.value = false;
  if (!canExport.value) return;
  exportError.value = "";
  try {
    const blob = await recommendationToDocxBlob(pipeline.recommendation.recommendation, {
      documentTitle: pipeline.analysis?.document_title,
    });
    triggerBlobDownload(blob, `${exportFilenameBase.value}.docx`);
  } catch {
    exportError.value = t("recommendDetail.errors.exportFailed");
  }
}

// ── v3 품질 루프 진행 카드 (spec/candidates/verdict/scorecard 프레임) ──
// v2 백엔드에선 이 값들이 항상 null이라 스트립 자체가 렌더되지 않는다(하위호환).
const liveCandidates = computed(() => pipeline.liveCandidates);
const liveVerdict = computed(() => pipeline.liveVerdict);
const liveScorecard = computed(() => pipeline.liveScorecard);
const candStatusText = computed(() => ({
  composing: t("recommendDetail.candStatus.composing"),
  verifying: t("recommendDetail.candStatus.verifying"),
  failed: t("recommendDetail.candStatus.failed"),
}));

// ── 질문 카드(needs_input, v3) — 미해소 카드만 보여주고 응답을 fill_cards 턴으로 보낸다 ──
const flowConfidence = computed(() => activeRec.value?.flow_confidence ?? null);
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

// 카드 목록이 바뀌면(새 버전 반영 등) 더 이상 없는 카드의 응답을 제거한다.
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
        <button
          v-if="canUseFlowActions"
          type="button"
          class="btn btn--outline panel__header-btn"
          :disabled="pipeline.recommendStatus === 'generating' || liveMode"
          @click="openFlowView"
        >
          {{ pipeline.recommendStatus === "generating" || liveMode ? t("recommendDetail.generating") : t("recommendDetail.viewFlow") }}
        </button>
        <div v-if="canExport" class="export-dd">
          <button
            type="button"
            class="btn btn--outline panel__header-btn export-dd__btn"
            :class="{ 'export-dd__btn--open': exportMenuOpen }"
            :aria-label="t('recommendDetail.exportTitle')"
            :aria-expanded="exportMenuOpen"
            aria-haspopup="listbox"
            @click="exportMenuOpen = !exportMenuOpen"
          >
            <span>{{ t("recommendDetail.exportTitle") }}</span>
            <svg class="export-dd__chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <Transition name="fade-up">
            <div v-if="exportMenuOpen" class="export-dd__menu" role="listbox" :aria-label="t('recommendDetail.exportTitle')">
              <button type="button" role="option" class="export-dd__item" @click="downloadJson">
                {{ t("recommendDetail.exportJson") }}
              </button>
              <button type="button" role="option" class="export-dd__item" @click="downloadMarkdown">
                {{ t("recommendDetail.exportMarkdown") }}
              </button>
              <button type="button" role="option" class="export-dd__item" @click="downloadDocx">
                {{ t("recommendDetail.exportDocx") }}
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <div class="panel__body">
      <!-- 실시간 생성/수정 상태 배너 — 스트림 프레임마다 캡션·위반 수가 갱신된다 -->
      <div v-if="liveMode" class="flow-live-status">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <span class="flow-live-status__caption">{{ pipeline.liveCaption || t("recommendDetail.composingFlow") }}</span>
        <span v-if="liveViolationCount" class="flow-live-status__violations">
          {{ t("recommendDetail.violationCount", { count: liveViolationCount }) }}
        </span>
      </div>

      <!-- v3 품질 루프 진행 스트립 — 후보 카드(트리는 승자 확정 후에만) · 심판 · 검증 요약 -->
      <div v-if="liveMode && (liveCandidates || liveVerdict || liveScorecard)" class="flow-quality-strip">
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
        <p v-if="liveVerdict" class="quality-verdict">
          {{ t("recommendDetail.verdictWinner", { winner: liveVerdict.winner, reason: liveVerdict.reason }) }}
        </p>
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

      <!-- 과거 세션 로딩 중 -->
      <div v-if="pipeline.sessionLoadStatus === 'loading'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ t("recommendDetail.sessionLoadingHint") }}</p>
      </div>

      <!-- 아직 아무 것도 없고 작업도 안 함 -->
      <div v-else-if="!hasActions && !working" class="empty-state">

        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <p>{{ t("recommendDetail.emptyState") }}</p>
      </div>

      <!-- 작업 중인데 아직 그릴 액션 프레임 전 (분석 중 / 생성 준비 중) -->
      <div v-else-if="!hasActions && working" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ workingText }}</p>
      </div>

      <!-- 흐름도 상세: 라이브/최종 공통. 중첩(컨테이너=분기) 트리 + 파라미터를 인라인 렌더 -->
      <div v-else class="rec-detail">
        <div v-if="inputVars.length || outputVars.length" class="rec-detail__vars">
          <div v-if="inputVars.length" class="rec-detail__var-group">
            <h4>{{ t("recommendDetail.inputVars") }}</h4>
            <ul>
              <li v-for="v in inputVars" :key="v.name">
                <strong>{{ v.name }}</strong>
                <span class="rec-detail__var-type">{{ v.type }}</span>
                <span v-if="v.description"> — {{ v.description }}</span>
              </li>
            </ul>
          </div>
          <div v-if="outputVars.length" class="rec-detail__var-group">
            <h4>{{ t("recommendDetail.outputVars") }}</h4>
            <ul>
              <li v-for="v in outputVars" :key="v.name">
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

    <div
      v-if="pipeline.recommendStatus === 'error' || pipeline.recommendSaveError || exportError"
      class="panel__footer panel__footer--errors"
    >
      <p v-if="pipeline.recommendStatus === 'error'" class="upload-error">{{ pipeline.recommendError }}</p>
      <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>
      <p v-if="exportError" class="upload-error">{{ exportError }}</p>
    </div>
  </section>
</template>
