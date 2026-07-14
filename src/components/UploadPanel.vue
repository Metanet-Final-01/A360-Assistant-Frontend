<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { evidenceLabel, formatBytes } from "../utils/format";

const pipeline = usePipelineStore();
const { t } = useI18n();

const isDragging = ref(false);
const fileInputRef = ref(null);
const inputMode = ref("file"); // file | text
const textDraft = ref("");

const fileSizeLabel = computed(() =>
  pipeline.file ? formatBytes(pipeline.file.size) : "",
);

const canStartAnalysis = computed(
  () =>
    pipeline.document?.status === "parsed" &&
    pipeline.analysisStatus === "idle",
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

function handleTextSubmit() {
  if (!textDraft.value.trim()) return;
  pipeline.submitTextRequest(textDraft.value);
}

function switchMode(mode) {
  inputMode.value = mode;
  pipeline.resetUpload();
  textDraft.value = "";
}

// ----- 분석 결과(WorkStep, schemas/analysis.py) 확인·편집 -----
// steps는 pipeline.analysis.steps와 동일한 참조 — splice/push로 직접 수정하면 그대로 반영된다.
// 편집은 이 세션에서만 유지되고 백엔드에는 저장되지 않는다(추천안 생성은 항상 서버에 저장된
// 원본 분석 결과를 기준으로 하므로, 여기서 단계를 고쳐도 추천안 생성 결과에는 반영되지 않는다).
const steps = computed(() => pipeline.analysis?.steps ?? []);
const hasSteps = computed(() => steps.value.length > 0);
const ambiguities = computed(() => pipeline.analysis?.ambiguities ?? []);

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

function onStepDragStart(idx, event) {
  dragIndex.value = idx;
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
  dragIndex.value = null;
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
  if (draftStepId.value === editingStepId.value) draftStepId.value = null;
  editingStepId.value = null;
}

function removeStep(stepId) {
  openMenuId.value = null;
  if (editingStepId.value === stepId) editingStepId.value = null;
  const idx = steps.value.findIndex((s) => s.step_id === stepId);
  if (idx !== -1) steps.value.splice(idx, 1);
  renumber();
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
        draggable="true"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="upload-panel-title">{{ t("upload.title") }}</h2>
    </header>

    <div class="panel__body">
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
            <circle cx="12" cy="12" r="10" fill="#e8f8ee" />
            <path
              d="M8 12.5l2.5 2.5L16 9.5"
              stroke="#1f9d55"
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
          <button type="button" class="btn btn--text" @click="pipeline.resetUpload">
            {{ inputMode === "text" ? t("upload.newTextRequest") : t("upload.newDocumentUpload") }}
          </button>
        </div>
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

        <div v-else-if="pipeline.analysisStatus === 'analyzing'" class="analyzing-state">
          <span class="analyzing-state__spinner" aria-hidden="true"></span>
          <p>{{ t("upload.analyzingHint") }}</p>
        </div>

        <div v-else-if="pipeline.analysisStatus === 'error'" class="analyzing-state analyzing-state--error">
          <p class="upload-error">{{ pipeline.analysisError }}</p>
          <button type="button" class="btn btn--outline" @click="pipeline.startAnalysis">{{ t("upload.retry") }}</button>
        </div>

        <template v-else-if="pipeline.analysisStatus === 'done'">
          <div class="analysis-summary" v-if="pipeline.analysis">
            <h3 v-if="pipeline.analysis.document_title">{{ pipeline.analysis.document_title }}</h3>
            <p>{{ pipeline.analysis.summary }}</p>
          </div>

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

          <div v-if="ambiguities.length" class="ambiguities-section">
            <h3 class="ambiguities-section__title">{{ t("upload.ambiguitiesTitle") }}</h3>
            <ul>
              <li v-for="(item, idx) in ambiguities" :key="idx">{{ item }}</li>
            </ul>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
