<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { evidenceLabel, formatBytes } from "../utils/format";
import { useFitTitle } from "../composables/useFitTitle";

const pipeline = usePipelineStore();
const { t } = useI18n();

const titleRef = ref(null);
useFitTitle(titleRef, () => t("upload.title"));

const isDragging = ref(false);
const fileInputRef = ref(null);
const inputMode = ref("file"); // file | text
const textDraft = ref("");
// 분석이 끝나면 업로드 상태(탭·문서 카드·분석 버튼)는 더 볼 일이 없는데도 화면을 차지해
// 아래 분석 결과가 좁아 보인다 — 패널 자체 높이는 고정(.panel--wide)이라 접어도 패널 크기는
// 그대로고, 접힌 만큼 분석 결과 영역이 넓어 보이는 효과만 낸다.
const uploadSectionCollapsed = ref(false);

// 텍스트 입력은 store가 아니라 이 컴포넌트가 로컬로 들고 있어서, 세션 전환(loadSession)이나
// "새 요청 입력"처럼 store 쪽에서 pipeline.file이 지워지는 경로를 여기서 따로 다 챙겨 부르기보다,
// file이 사라지는 시점 자체를 감시해서 지운다. 다만 watch는 값이 실제로 바뀔 때만 발동해서
// file이 이미 null인 상태(예: 파일 없이 텍스트만 쓰던 중)의 리셋은 못 잡는다 — 그 경우는
// switchMode에서 명시적으로 지운다.
watch(
  () => pipeline.file,
  (file) => {
    if (!file) textDraft.value = "";
  },
);

const fileSizeLabel = computed(() =>
  pipeline.file ? formatBytes(pipeline.file.size) : "",
);

const canStartAnalysis = computed(
  () =>
    pipeline.document?.status === "parsed" &&
    pipeline.analysisStatus === "idle" &&
    pipeline.visionStatus !== "enriching",
);

// 비전 보강(FR-03)은 vision.py가 지원하는 포맷(PDF/PPTX, PPT는 내부적으로 PPTX로 변환된 뒤
// 처리됨)에서만, 그리고 분석을 시작하기 전에만 의미가 있다 — 분석이 이미 parsed_content를
// 읽어간 뒤에는 뒤늦게 보강해도 반영되지 않는다.
const VISION_EXTS = new Set(["pdf", "pptx", "ppt"]);
const canEnrichVision = computed(
  () =>
    pipeline.document?.status === "parsed" &&
    pipeline.analysisStatus === "idle" &&
    VISION_EXTS.has(pipeline.file?.ext),
);

function openFileDialog() {
  fileInputRef.value?.click();
}

function handleFiles(fileList) {
  const file = fileList?.[0];
  if (file) pipeline.selectFile(file);
}

function onDrop(event) {
  isDragging.value = false;
  handleFiles(event.dataTransfer?.files);
}

// 파일 드래그일 때만 드롭존을 하이라이트한다 — 패널 재배치 그립이나
// 분석 결과 카드 드래그가 지나갈 때는 반응하지 않는다.
function onDropzoneDragOver(event) {
  isDragging.value = !!event.dataTransfer?.types?.includes("Files");
}

function onFileChange(event) {
  handleFiles(event.target.files);
  event.target.value = "";
}

// 텍스트 입력은 파일과 달리 파싱이 곧장 끝나(status가 바로 "parsed") 검토할 추출 결과가
// 따로 없다 — 그래서 제출 즉시 분석까지 이어 붙여, 파일 업로드처럼 "분석 시작"을 한 번 더
// 눌러야 하는 중간 단계 없이 바로 분석 진행 상태로 넘어가게 한다.
async function handleTextSubmit() {
  if (!textDraft.value.trim()) return;
  const doc = await pipeline.submitTextRequest(textDraft.value);
  if (doc?.status === "parsed") {
    pipeline.startAnalysis();
  }
}

function switchMode(mode) {
  inputMode.value = mode;
  textDraft.value = "";
  pipeline.resetUpload();
}

function resetUploadSection() {
  // 접힌 상태로 리셋하면, 이 토글 버튼 자체가 analysisStatus==='idle'일 때 사라져서
  // 다시 펼칠 방법이 없어진다 — 새 문서/요청을 시작할 땐 항상 펼쳐 둔다.
  uploadSectionCollapsed.value = false;
  pipeline.resetUpload();
}

// ----- 분석 결과(WorkStep, schemas/analysis.py) 확인·편집 -----
// steps는 pipeline.analysis.steps와 동일한 참조 — splice/push로 직접 수정하면 그대로 반영된다.
// 편집(드래그/수정/삭제/추가)은 우선 메모리에서만 일어나고, 흐름도가 이미 생성돼 있으면
// 아래 "흐름도에 저장" 버튼이 편집 내용을 추천 트리에 투영해 새 버전으로 저장한다
// (pipeline.applyAnalysisEditsToFlow — 제스처마다 저장하면 버전이 폭증하므로 명시 버튼 1회 = 1버전).
// 각 편집 지점은 markAnalysisEdited()로 종류만 기록해 두고, 저장 시 change_summary로 묶인다.
const steps = computed(() => pipeline.analysis?.steps ?? []);
const hasSteps = computed(() => steps.value.length > 0);

// 분석 스트리밍(RPA — 분석도 실시간) — 백엔드가 분석을 요약→단계 순으로 흘려보내는 라이브
// 스냅샷. 분석이 끝나기 전(analyzing)에 이걸 읽기 전용으로 렌더해 결과가 채워지는 걸 보여준다.
// 완료(done) 시엔 pipeline.analysis(편집 가능본)로 교체된다.
const liveAnalysis = computed(() => pipeline.liveAnalysis);
const liveAnalysisSteps = computed(() => pipeline.liveAnalysis?.steps ?? []);

const analysisBodyRef = ref(null);
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
  const container = analysisBodyRef.value;
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
  const el = analysisBodyRef.value;
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
      if (targetIndex === -1) targetIndex = dragStartSlots.length - 1;
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

function closeMenuOnOutsideClick(event) {
  if (openMenuId.value !== null && !event.target.closest(".flow-card__menu-wrap")) {
    openMenuId.value = null;
  }
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
</script>

<template>
  <section class="panel panel--wide" aria-labelledby="upload-panel-title" data-tour="upload">
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="upload-panel-title" ref="titleRef">{{ t("upload.title") }}</h2>
    </header>

    <div class="panel__body">
      <div
        class="upload-section-body"
        :class="{ 'upload-section-body--collapsed': uploadSectionCollapsed }"
        :aria-hidden="uploadSectionCollapsed"
        :inert="uploadSectionCollapsed"
      >
       <div class="upload-section-body__inner">
        <div class="upload-mode-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="inputMode === 'file'"
            class="upload-mode-toggle__btn"
            :class="{ 'upload-mode-toggle__btn--active': inputMode === 'file' }"
            @click="switchMode('file')"
          >
            {{ t("upload.fileTab") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="inputMode === 'text'"
            class="upload-mode-toggle__btn"
            :class="{ 'upload-mode-toggle__btn--active': inputMode === 'text' }"
            @click="switchMode('text')"
          >
            {{ t("upload.textTab") }}
          </button>
        </div>

        <div
          v-if="inputMode === 'file' && !pipeline.file"
          class="dropzone"
          :class="{ 'dropzone--active': isDragging }"
          role="button"
          tabindex="0"
          @click="openFileDialog"
          @keydown.enter="openFileDialog"
          @dragover.prevent="onDropzoneDragOver"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <svg class="dropzone__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v12m0-12 4 4m-4-4-4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <p class="dropzone__text">
            <strong>{{ t("upload.dropzone.fileTypes") }}</strong> {{ t("upload.dropzone.hint") }}
          </p>
          <span class="dropzone__button">{{ t("upload.dropzone.selectButton") }}</span>
          <input
            ref="fileInputRef"
            type="file"
            accept=".pdf,.ppt,.pptx,.docx"
            class="sr-only"
            @change="onFileChange"
          />
        </div>

        <div v-else-if="inputMode === 'text' && !pipeline.file" class="text-input-area">
          <textarea
            v-model="textDraft"
            class="text-input-area__field"
            rows="6"
            :placeholder="t('upload.textPlaceholder')"
          ></textarea>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!textDraft.trim()"
            @click="handleTextSubmit"
          >
            {{ t("upload.startFromText") }}
          </button>
        </div>

        <p v-if="pipeline.uploadStatus === 'error'" class="upload-error">
          {{ pipeline.uploadError }}
        </p>

        <div class="uploaded-doc" v-if="pipeline.file">
          <h3 class="uploaded-doc__label">{{ inputMode === "text" ? t("upload.inputRequestLabel") : t("upload.uploadedDocLabel") }}</h3>

          <div class="doc-card">
            <span class="doc-card__icon">{{ pipeline.file.ext.toUpperCase() }}</span>
            <div class="doc-card__info">
              <span class="doc-card__name">{{ pipeline.file.name }}</span>
              <span class="doc-card__size">{{ fileSizeLabel }}</span>
            </div>
            <span
              v-if="pipeline.uploadStatus === 'uploading'"
              class="doc-card__status doc-card__status--loading"
              :aria-label="t('upload.status.uploading')"
            ></span>
            <svg
              v-else-if="pipeline.uploadStatus === 'error'"
              class="doc-card__status doc-card__status--done"
              viewBox="0 0 24 24"
              fill="none"
              :aria-label="t('upload.status.failed')"
            >
              <circle cx="12" cy="12" r="10" fill="var(--danger-bg)" />
              <path
                d="M9 9l6 6m0-6-6 6"
                stroke="var(--danger)"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg
              v-else
              class="doc-card__status doc-card__status--done"
              viewBox="0 0 24 24"
              fill="none"
              :aria-label="t('upload.status.done')"
            >
              <circle cx="12" cy="12" r="10" fill="var(--success-bg)" />
              <path
                d="M8 12.5l2.5 2.5L16 9.5"
                stroke="var(--success)"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <Transition name="fade-up">
            <ul class="extraction-meta" v-if="pipeline.document?.status === 'parsed'">
              <li v-if="pipeline.document.page_count != null">
                {{ t("upload.status.parsedWithPage", { page: pipeline.document.page_count }) }}
              </li>
              <li v-else>{{ t("upload.status.processedDone") }}</li>
              <li v-for="(warning, idx) in pipeline.document.warnings" :key="idx" class="extraction-meta__warning">
                ⚠ {{ warning }}
              </li>
            </ul>
          </Transition>

          <!-- 비전 보강(FR-03) — 스캔본 등 텍스트가 부족한 페이지를 vision LLM으로 다시 읽는다.
               페이지당 LLM 호출이라 자동이 아니라 사용자가 명시적으로 트리거한다. -->
          <div v-if="canEnrichVision || pipeline.visionStatus !== 'idle'" class="vision-enrich">
            <button
              v-if="pipeline.visionStatus === 'idle' || pipeline.visionStatus === 'error'"
              type="button"
              class="btn btn--outline"
              :disabled="!canEnrichVision"
              @click="pipeline.enrichVisionForDocument"
            >
              {{ t("upload.vision.button") }}
            </button>
            <p v-if="pipeline.visionStatus === 'enriching'" class="vision-enrich__status">
              <span class="vision-enrich__spinner" aria-hidden="true"></span>
              {{ pipeline.visionStage || t("upload.vision.enriching") }}
            </p>
            <p v-if="pipeline.visionStatus === 'done'" class="vision-enrich__status vision-enrich__status--done">
              {{
                pipeline.enrichedPages?.length
                  ? t("upload.vision.done", { count: pipeline.enrichedPages.length }, pipeline.enrichedPages.length)
                  : t("upload.vision.noneNeeded")
              }}
            </p>
            <p v-if="pipeline.visionStatus === 'error'" class="vision-enrich__status vision-enrich__status--error">
              {{ pipeline.visionError || t("upload.vision.failed") }}
            </p>
          </div>

          <div class="upload-actions">
            <button
              type="button"
              class="btn btn--primary"
              :disabled="!canStartAnalysis"
              @click="pipeline.startAnalysis"
            >
              <span v-if="pipeline.analysisStatus === 'analyzing'">{{ t("upload.analysis.progress") }}</span>
              <span v-else-if="pipeline.analysisStatus === 'done'">{{ t("upload.analysis.done") }}</span>
              <span v-else>{{ t("upload.analysis.start") }}</span>
            </button>
          </div>
        </div>
       </div>
      </div>

      <div v-if="pipeline.file" class="upload-section-toggle">
        <button type="button" class="btn btn--text" @click="resetUploadSection">
          {{ inputMode === "text" ? t("upload.newTextRequest") : t("upload.newDocumentUpload") }}
        </button>
        <button
          v-if="pipeline.analysisStatus !== 'idle'"
          type="button"
          class="upload-section-toggle__btn"
          :aria-expanded="!uploadSectionCollapsed"
          @click="uploadSectionCollapsed = !uploadSectionCollapsed"
        >
          {{ uploadSectionCollapsed ? t("upload.expandSection") : t("upload.collapseSection") }}
          <svg
            class="upload-section-toggle__chevron"
            :class="{ 'upload-section-toggle__chevron--collapsed': uploadSectionCollapsed }"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <div
        v-if="pipeline.sessionLoadStatus === 'loading' || pipeline.analysisStatus !== 'idle'"
        class="analysis-results"
        data-tour="analysis"
        ref="analysisBodyRef"
      >
        <div v-if="pipeline.sessionLoadStatus === 'loading'" class="analyzing-state">
          <span class="analyzing-state__spinner" aria-hidden="true"></span>
          <p>{{ t("upload.sessionLoadingHint") }}</p>
        </div>

        <!-- 분석 중: 스트리밍 렌더(요약 → 단계 하나씩). 첫 프레임 전엔 스피너 -->
        <template v-else-if="pipeline.analysisStatus === 'analyzing'">
          <div v-if="liveAnalysis" class="analysis-live">
            <div class="flow-live-status">
              <span class="analyzing-state__spinner" aria-hidden="true"></span>
              <span class="flow-live-status__caption">{{ pipeline.liveCaption || t("upload.analyzingHint") }}</span>
            </div>
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

        <template v-else-if="pipeline.analysisStatus === 'done'">
          <div v-if="!hasSteps" class="empty-state">
            <p>{{ t("upload.noStepsFound") }}</p>
          </div>

          <TransitionGroup
            name="rec-list"
            tag="div"
            class="rec-list"
            @dragover.prevent
            @drop="onStepDrop"
          >
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

                <footer v-if="step.evidence" class="rec-card__footer">{{ t("upload.evidencePrefix", { evidence: evidenceLabel(step.evidence) }) }}</footer>
              </template>
            </article>
          </TransitionGroup>

          <button
            type="button"
            class="flow-add-btn"
            :disabled="editingStepId !== null"
            @click="startAddStep"
          >
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
          <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>
        </template>
      </div>
    </div>

    <div class="panel__bottom-fade" aria-hidden="true"></div>
  </section>
</template>
