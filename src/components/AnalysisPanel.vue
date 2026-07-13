<script setup>
import { computed, defineAsyncComponent, ref } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport } from "../api/recommend";
import { evidenceLabel } from "../utils/format";
import { buildPackageColorMap, confidenceBadge, flattenActions } from "../utils/recommendation";

// "흐름도 보기" 버튼을 눌러야만 열리는 모달이라, 분석 페이지 초기 번들에서 빼서
// 실제로 열 때만 내려받는다.
const RecommendationFlowModal = defineAsyncComponent(() => import("./RecommendationFlowModal.vue"));

// 루트 노드가 여러 개(패널 + 로딩 오버레이 + 모달)라 attrs 자동 전달이 안 되므로,
// 패널 재배치용 data-panel-key/order 스타일을 패널 섹션에 직접 물려준다.
defineOptions({ inheritAttrs: false });

const pipeline = usePipelineStore();

const showFlowModal = ref(false);

const emptyState = computed(() => pipeline.analysisStatus === "idle");
// steps는 pipeline.analysis.steps와 동일한 참조 — splice/push로 직접 수정하면 그대로 반영된다.
// 편집은 이 세션에서만 유지되고 백엔드에는 저장되지 않는다(추천안 생성은 항상 서버에 저장된
// 원본 분석 결과를 기준으로 하므로, 여기서 단계를 고쳐도 추천안 생성 결과에는 반영되지 않는다).
const steps = computed(() => pipeline.analysis?.steps ?? []);
const hasSteps = computed(() => steps.value.length > 0);
const ambiguities = computed(() => pipeline.analysis?.ambiguities ?? []);

// 액션/패키지는 분석 결과(WorkStep, schemas/analysis.py)가 아니라 추천 흐름도
// (RecommendedAction, schemas/recommendation.py)에만 있는 정보다 — step_id로 매칭해서
// 카드에 얹는다. 추천안이 아직 없으면(흐름도 보기 전) 자연히 빈 배열이라 아무 것도 안 뜬다.
const packageColor = computed(() => buildPackageColorMap(pipeline.recommendation?.recommendation?.steps));

function colorFor(pkg) {
  return packageColor.value.get(pkg || "미지정") ?? "#888888";
}

const recommendedActionsByStep = computed(() => {
  const map = new Map();
  (pipeline.recommendation?.recommendation?.steps ?? []).forEach((stepRec) => {
    map.set(
      stepRec.step_id,
      flattenActions(stepRec.actions).map((a) => ({ ...a, badge: confidenceBadge(a.confidence) })),
    );
  });
  return map;
});

function actionsForStep(stepId) {
  return recommendedActionsByStep.value.get(stepId) ?? [];
}

const dragIndex = ref(null);
const dragVisualHidden = ref(false);
const panelBodyRef = ref(null);
const openMenuId = ref(null);
const editingStepId = ref(null);
const stepForm = ref({
  name: "",
  description: "",
  inputs: "",
  outputs: "",
  systems: "",
  branching: "",
  evidenceSnippet: "",
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
  const container = panelBodyRef.value;
  if (!container) {
    dragStartSlots = null;
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const cards = container.querySelectorAll(".rec-card");
  dragStartSlots = Array.from(cards).map((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top - containerRect.top + container.scrollTop;
    return { mid: top + r.height / 2 };
  });
}

function trackPointer(event) {
  lastPointerY = event.clientY;
}

function runDragFrame() {
  const el = panelBodyRef.value;
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

function onDragStart(idx, event) {
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

function onDrop(event) {
  event.preventDefault();
}

function onDragEnd() {
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
  };
}

function cancelEditStep() {
  // 방금 "+ 업무 단계 추가"로 만든, 아직 아무것도 채우지 않은 카드면 취소 시 함께 지운다.
  if (editingStepId.value !== null) {
    const idx = steps.value.findIndex((s) => s.step_id === editingStepId.value);
    const draft = idx !== -1 ? steps.value[idx] : null;
    const isUnfilledDraft =
      draft &&
      draft.name === "새 업무 단계" &&
      !draft.description &&
      !draft.inputs?.length &&
      !draft.outputs?.length &&
      !draft.systems?.length;
    if (isUnfilledDraft) {
      steps.value.splice(idx, 1);
      renumber();
    }
  }
  editingStepId.value = null;
}

function saveEditStep() {
  const step = steps.value.find((s) => s.step_id === editingStepId.value);
  if (!step) return;
  step.name = stepForm.value.name.trim() || "이름 없음";
  step.description = stepForm.value.description.trim();
  step.inputs = fromCsv(stepForm.value.inputs);
  step.outputs = fromCsv(stepForm.value.outputs);
  step.systems = fromCsv(stepForm.value.systems);
  step.branching = stepForm.value.branching.trim() || null;
  const snippet = stepForm.value.evidenceSnippet.trim();
  step.evidence = snippet ? { page: step.evidence?.page ?? null, snippet } : null;
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
  const list = steps.value;
  const newStep = {
    step_id: crypto.randomUUID(),
    order: list.length + 1,
    name: "새 업무 단계",
    description: "",
    inputs: [],
    outputs: [],
    systems: [],
    branching: null,
    evidence: null,
  };
  list.push(newStep);
  startEditStep(newStep);
}

// "흐름도 보기" 버튼 하나로 생성+열람을 합친다 — 이미 만들어진 게 있으면 바로 보여주고,
// 없거나 이전 시도가 실패했으면 먼저 생성한 뒤 성공 시에만 모달을 연다.
async function openFlowView() {
  if (pipeline.recommendStatus === "done") {
    showFlowModal.value = true;
    return;
  }
  await pipeline.startRecommend();
  if (pipeline.recommendStatus === "done") {
    showFlowModal.value = true;
  }
}

// 내보내기는 프론트 로컬 Blob이 아니라 백엔드 표준 export API 응답을 그대로 저장한다
// (P1-3 — schema_version 포함 봉투, 골든셋 채점 포맷과 일치). 추천안 버전이 있어야 가능.
const exportError = ref("");
const canExport = computed(() => !!pipeline.sessionId && pipeline.recommendation?.version != null);

async function downloadJson() {
  if (!canExport.value) return;
  exportError.value = "";
  try {
    await downloadRecommendationExport(pipeline.sessionId, pipeline.recommendation.version);
  } catch (err) {
    exportError.value = err?.message ?? "내보내기에 실패했습니다.";
  }
}
</script>

<template>
  <section
    class="panel panel--wide"
    aria-labelledby="analysis-panel-title"
    data-tour="analysis"
    v-bind="$attrs"
  >
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        draggable="true"
        data-panel-handle
        title="드래그하여 패널 위치 이동"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="analysis-panel-title">분석 결과</h2>
    </header>

    <div class="panel__body" ref="panelBodyRef">
      <div v-if="emptyState" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <p>업무정의서를 업로드하고 분석을 시작하면<br />단계별 분석 결과가 여기에 표시됩니다.</p>
      </div>

      <div v-else-if="pipeline.analysisStatus === 'analyzing'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>분석 중… 진행 상태는 챗봇에서 확인할 수 있습니다.</p>
      </div>

      <div v-else-if="pipeline.analysisStatus === 'error'" class="analyzing-state analyzing-state--error">
        <p class="upload-error">{{ pipeline.analysisError }}</p>
        <button type="button" class="btn btn--outline" @click="pipeline.startAnalysis">다시 시도</button>
      </div>

      <template v-else-if="pipeline.analysisStatus === 'done'">
        <div class="analysis-summary" v-if="pipeline.analysis">
          <h3 v-if="pipeline.analysis.document_title">{{ pipeline.analysis.document_title }}</h3>
          <p>{{ pipeline.analysis.summary }}</p>
        </div>

        <div v-if="!hasSteps" class="empty-state">
          <p>문서에서 분석 가능한 업무 단계를 찾지 못했습니다. 아래 버튼으로 직접 추가할 수 있습니다.</p>
        </div>

        <TransitionGroup
          name="rec-list"
          tag="div"
          class="rec-list"
          @dragover.prevent
          @drop="onDrop"
        >
          <article
            v-for="(step, idx) in steps"
            :key="step.step_id"
            class="rec-card"
            :class="{ 'rec-card--dragging': dragVisualHidden && dragIndex === idx }"
            draggable="true"
            @dragstart="onDragStart(idx, $event)"
            @dragend="onDragEnd"
            @click="closeMenuOnOutsideClick"
          >
            <template v-if="editingStepId === step.step_id">
              <div class="flow-card__edit-grid">
                <label class="flow-card__edit-wide">
                  <span>제목</span>
                  <input v-model="stepForm.name" type="text" />
                </label>
                <label class="flow-card__edit-wide">
                  <span>설명</span>
                  <input v-model="stepForm.description" type="text" />
                </label>
                <label>
                  <span>입력 (쉼표로 구분)</span>
                  <input v-model="stepForm.inputs" type="text" />
                </label>
                <label>
                  <span>출력 (쉼표로 구분)</span>
                  <input v-model="stepForm.outputs" type="text" />
                </label>
                <label>
                  <span>연계 시스템 (쉼표로 구분)</span>
                  <input v-model="stepForm.systems" type="text" />
                </label>
                <label>
                  <span>분기</span>
                  <input v-model="stepForm.branching" type="text" />
                </label>
                <label class="flow-card__edit-wide">
                  <span>근거</span>
                  <input v-model="stepForm.evidenceSnippet" type="text" />
                </label>
              </div>
              <div class="flow-card__actions">
                <button type="button" class="btn btn--outline" @click="cancelEditStep">취소</button>
                <button type="button" class="btn btn--primary" @click="saveEditStep">저장</button>
              </div>
            </template>

            <template v-else>
              <header class="rec-card__header">
                <div class="rec-card__header-left">
                  <span class="flow-card__handle" aria-hidden="true" title="드래그해서 순서 변경">⠿</span>
                  <h3>{{ step.order }}. {{ step.name }}</h3>
                </div>
                <div class="flow-card__menu-wrap">
                  <button
                    type="button"
                    class="flow-card__menu-btn"
                    aria-label="업무 단계 옵션"
                    @click="toggleMenu(step.step_id, $event)"
                  >
                    &#8942;
                  </button>
                  <Transition name="fade-up">
                    <div v-if="openMenuId === step.step_id" class="flow-card__menu" role="menu">
                      <button type="button" role="menuitem" @click="startEditStep(step)">수정</button>
                      <button
                        type="button"
                        role="menuitem"
                        class="flow-card__menu-danger"
                        @click="removeStep(step.step_id)"
                      >
                        삭제
                      </button>
                    </div>
                  </Transition>
                </div>
              </header>

              <p class="rec-card__description">{{ step.description }}</p>

              <div class="rec-card__grid">
                <div class="rec-card__field">
                  <span class="rec-card__field-label">입력</span>
                  <span class="rec-card__field-value">{{ step.inputs?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field">
                  <span class="rec-card__field-label">출력</span>
                  <span class="rec-card__field-value">{{ step.outputs?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field">
                  <span class="rec-card__field-label">연계 시스템</span>
                  <span class="rec-card__field-value">{{ step.systems?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field" v-if="step.branching">
                  <span class="rec-card__field-label">분기</span>
                  <span class="rec-card__field-value">{{ step.branching }}</span>
                </div>

                <ul v-if="actionsForStep(step.step_id).length" class="rec-card__action-list">
                  <li v-for="(a, i) in actionsForStep(step.step_id)" :key="i" class="rec-card__action-chip">
                    <span class="rec-card__action-chip-label">{{ a.label }}</span>
                    <span
                      v-if="a.badge"
                      class="confidence-badge"
                      :class="`confidence-badge--${a.badge.level}`"
                    >
                      {{ a.badge.text }}
                    </span>
                    <span class="rec-card__action-chip-package" :style="{ background: colorFor(a.package) }">
                      {{ a.package }}
                    </span>
                  </li>
                </ul>
              </div>

              <footer v-if="step.evidence" class="rec-card__footer">근거: {{ evidenceLabel(step.evidence) }}</footer>
            </template>
          </article>
        </TransitionGroup>

        <button type="button" class="flow-add-btn" @click="startAddStep">+ 업무 단계 추가</button>

        <div v-if="ambiguities.length" class="ambiguities-section">
          <h3 class="ambiguities-section__title">확인 필요</h3>
          <ul>
            <li v-for="(item, idx) in ambiguities" :key="idx">{{ item }}</li>
          </ul>
        </div>
      </template>
    </div>

    <div v-if="pipeline.analysisStatus === 'done' && hasSteps" class="panel__footer">
      <div class="recommend-section">
        <h3 class="export-section__title">A360 흐름도 추천</h3>

        <div class="recommend-section__actions">
          <span v-if="pipeline.recommendation" class="recommend-section__version">
            v{{ pipeline.recommendation.version }}
          </span>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="pipeline.recommendStatus === 'generating'"
            @click="openFlowView"
          >
            {{ pipeline.recommendStatus === "generating" ? "생성 중…" : "흐름도 보기" }}
          </button>
        </div>
        <p v-if="pipeline.recommendStatus === 'error'" class="upload-error recommend-section__save-error">
          {{ pipeline.recommendError }}
        </p>
        <p v-if="pipeline.recommendSaveError" class="upload-error recommend-section__save-error">
          {{ pipeline.recommendSaveError }}
        </p>
      </div>

      <div class="export-section">
        <h3 class="export-section__title">내보내기</h3>
        <div class="export-section__actions">
          <button
            type="button"
            class="btn btn--outline"
            :disabled="!canExport"
            :title="canExport ? '' : '흐름도(추천안)를 먼저 생성해야 내보낼 수 있습니다'"
            @click="downloadJson"
          >
            JSON 내보내기
          </button>
        </div>
        <p v-if="exportError" class="upload-error recommend-section__save-error">{{ exportError }}</p>
      </div>
    </div>
  </section>

  <div v-if="pipeline.recommendStatus === 'generating'" class="modal-overlay" role="alertdialog" aria-live="polite" aria-busy="true">
    <div class="modal modal--recommend-loading">
      <div class="modal__body modal__body--center">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>추천안을 생성하는 중… 진행 상태는 챗봇에서 확인할 수 있습니다.</p>
      </div>
    </div>
  </div>

  <RecommendationFlowModal v-if="showFlowModal" @close="showFlowModal = false" />
</template>
