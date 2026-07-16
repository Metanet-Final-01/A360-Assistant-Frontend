<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { formatDateShort } from "../utils/dateFormat";
import FlowCanvas from "./flow-canvas/FlowCanvas.vue";

const pipeline = usePipelineStore();
const { t } = useI18n();

const emit = defineEmits(["close"]);

onBeforeUnmount(() => {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
});

// steps→actions→children 트리를 FlowCanvas가 분기 컬럼·중첩 그대로 그린다(Vue Flow 캔버스,
// 확대/축소·팬·텍스트 편집·드래그 재정렬 가능). 편집은 캔버스 안의 로컬 버퍼에만 쌓이고,
// 아래 저장 버튼을 눌러야 새 버전으로 저장된다.
const steps = computed(() => pipeline.recommendation?.recommendation?.steps ?? []);
const hasActions = computed(() => steps.value.some((s) => (s.actions?.length ?? 0) > 0));

const flowCanvasRef = ref(null);
const canvasDirty = ref(false);
const canvasSaving = ref(false);
const isMaximized = ref(false);

// 최대화 버튼을 누른 순간에만 브라우저 실제 전체화면 모드로 전환한다 — 주소창까지 포함해
// 화면을 진짜로 다 채우려면 이 방법뿐이다(전체화면 진입 토스트·Esc로 풀리는 건 감수하기로 함).
// 모달을 그냥 열기만 했을 때는 전체화면으로 전환하지 않는다.
function toggleMaximize() {
  isMaximized.value = !isMaximized.value;
  if (isMaximized.value) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

// ----- 창 드래그 이동(챗봇 팝업과 동일한 방식) -----
// 최대화 상태가 아닐 때만 헤더를 드래그해 창을 옮길 수 있다 — 이때는 전체화면 모드가 꺼져
// 있으므로 이동 가능 범위는 브라우저 뷰포트(주소창 아래) 안으로 제한된다.
const modalRef = ref(null);
const position = reactive({ x: null, y: null });
const isDragging = ref(false);
let dragOffset = { x: 0, y: 0 };

const modalStyle = computed(() => {
  if (isMaximized.value || position.x === null) return {};
  return { position: "fixed", left: `${position.x}px`, top: `${position.y}px`, margin: 0 };
});

function startDrag(event) {
  if (isMaximized.value || !modalRef.value) return;
  isDragging.value = true;
  const rect = modalRef.value.getBoundingClientRect();
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  position.x = rect.left;
  position.y = rect.top;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", stopDrag);
}

function onDragMove(event) {
  if (!isDragging.value || !modalRef.value) return;
  const width = modalRef.value.offsetWidth;
  const height = modalRef.value.offsetHeight;
  const maxX = window.innerWidth - width;
  const maxY = window.innerHeight - height;
  position.x = Math.min(Math.max(0, event.clientX - dragOffset.x), Math.max(0, maxX));
  position.y = Math.min(Math.max(0, event.clientY - dragOffset.y), Math.max(0, maxY));
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", stopDrag);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", stopDrag);
});

// "편집" 버튼을 눌러야만 텍스트 수정·드래그 재정렬이 가능하다 — 그 전에는 확대/축소·화면
// 이동처럼 흐름도 내용에 영향을 주지 않는 조작만 허용한다(FlowCanvas의 editable prop이
// 텍스트 편집 가능 여부와 노드 드래그 가능 여부를 함께 잠근다).
const isEditMode = ref(false);

function startEditMode() {
  isEditMode.value = true;
}

// 변경사항이 없을 때 "편집 종료" — 버릴 게 없으니 그냥 편집 모드에서 나간다.
function exitEditMode() {
  isEditMode.value = false;
}

// 변경사항이 있을 때 "편집 취소" — 저장 안 한 변경을 버리고 편집 모드에서도 나간다(취소=편집을
// 그만두는 것이므로, 버리기와 나가기를 한 번에 묶는다 — 별도의 "편집 종료" 버튼을 더 안 둔다).
function discardCanvasEdits() {
  flowCanvasRef.value?.discard();
  isEditMode.value = false;
}

// 오버레이 클릭·닫기 버튼 모두 이 핸들러를 거친다 — 저장 중엔 닫지 않고(비동기 저장이
// 언마운트된 캔버스에 대고 끝나 버리는 걸 막는다), 저장 안 한 편집이 있으면 확인 없이
// 조용히 버리지 않는다.
function handleClose() {
  if (canvasSaving.value) return;
  if (canvasDirty.value) {
    if (!window.confirm(t("recommendFlow.discardConfirm"))) return;
    flowCanvasRef.value?.discard();
  }
  emit("close");
}

// FlowCanvas는 steps 배열만 다루지만, 저장 API는 Recommendation 트리 전체({ steps, notes, ... })를
// 기대한다 — 원본 객체에 편집된 steps만 덮어써서 notes 등 나머지 필드를 보존한다. 저장 후에는
// 편집 모드에 머문다(계속 이어서 고칠 수 있게) — 다 됐으면 "편집 종료"로 나가면 된다.
async function saveCanvasEdits() {
  await flowCanvasRef.value?.save((editedSteps, summary) =>
    pipeline.saveRecommendationEdit({ ...pipeline.recommendation.recommendation, steps: editedSteps }, summary),
  );
}

// ----- 버전 이력 -----
const showHistory = ref(false);
const revertingVersion = ref(null);

pipeline.loadRecommendationHistory();

const KNOWN_SOURCES = ["llm", "drag", "chat", "feedback"];

function versionDescription(v) {
  if (v.change_summary) return v.change_summary;
  if (v.source && KNOWN_SOURCES.includes(v.source)) return t(`recommendFlow.source.${v.source}`);
  return v.source || "";
}

// 백엔드에 개별 버전 조회 API가 없어, 이 브라우저 세션에서 트리를 캐시해 둔 버전만 되돌릴 수 있다.
function canRevert(v) {
  return v.version !== pipeline.recommendation?.version && !!pipeline.recommendTreesByVersion[v.version];
}

async function revertTo(version) {
  if (revertingVersion.value !== null) return;
  revertingVersion.value = version;
  await pipeline.revertToRecommendationVersion(version);
  revertingVersion.value = null;
}

const formatDate = formatDateShort;
</script>

<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div
      ref="modalRef"
      class="modal modal--flow"
      :class="{ 'modal--flow-maximized': isMaximized, 'modal--flow-dragging': isDragging }"
      :style="modalStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rec-flow-modal-title"
    >
      <header class="modal__header" @pointerdown="startDrag">
        <h2 id="rec-flow-modal-title">
          {{ t("recommendFlow.title") }}
          <span v-if="pipeline.recommendation?.version" class="flow-version-badge">
            v{{ pipeline.recommendation.version }}
          </span>
        </h2>
        <div class="modal__header-actions">
          <button
            type="button"
            class="modal__maximize"
            :aria-label="isMaximized ? t('recommendFlow.restore') : t('recommendFlow.maximize')"
            @click="toggleMaximize"
          >
            <svg v-if="!isMaximized" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button type="button" class="modal__close" :aria-label="t('common.close')" @click="handleClose">✕</button>
        </div>
      </header>

      <div class="modal__body modal__body--flow">
        <div class="flow-toolbar">
          <p class="flow-hint">
            {{ t("recommendFlow.hint") }}
            <span v-if="canvasDirty" class="flow-save-status">{{ t("recommendFlow.unsavedHint") }}</span>
          </p>
          <div class="flow-toolbar__actions">
            <template v-if="isEditMode">
              <template v-if="canvasDirty">
                <button type="button" class="btn btn--outline" :disabled="canvasSaving" @click="discardCanvasEdits">
                  {{ t("recommendFlow.discard") }}
                </button>
                <button type="button" class="btn btn--primary" :disabled="canvasSaving" @click="saveCanvasEdits">
                  {{ canvasSaving ? t("recommendFlow.saving") : t("recommendFlow.save") }}
                </button>
              </template>
              <button v-else type="button" class="btn btn--outline" @click="exitEditMode">
                {{ t("recommendFlow.exitEdit") }}
              </button>
            </template>
            <button v-else type="button" class="btn btn--primary" :disabled="!hasActions" @click="startEditMode">
              {{ t("recommendFlow.edit") }}
            </button>
            <button type="button" class="btn btn--outline" @click="showHistory = !showHistory">
              {{ t("recommendFlow.versionHistory") }}
            </button>
          </div>
        </div>

        <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>

        <div v-if="showHistory" class="flow-history">
          <h3 class="flow-history__title">{{ t("recommendFlow.versionHistory") }}</h3>
          <p v-if="!pipeline.recommendVersions.length" class="flow-history__empty">
            {{ t("recommendFlow.noVersions") }}
          </p>
          <ol v-else class="flow-history__list">
            <li v-for="v in pipeline.recommendVersions" :key="v.id" class="flow-history__item">
              <div class="flow-history__meta">
                <strong>v{{ v.version }}</strong>
                <span v-if="v.version === pipeline.recommendation?.version" class="flow-history__current">
                  {{ t("recommendFlow.current") }}
                </span>
                <span class="flow-history__desc">{{ versionDescription(v) }}</span>
                <time class="flow-history__date">{{ formatDate(v.created_at) }}</time>
              </div>
              <button
                v-if="canRevert(v)"
                type="button"
                class="btn btn--outline flow-history__revert"
                :disabled="revertingVersion !== null"
                @click="revertTo(v.version)"
              >
                {{ revertingVersion === v.version ? t("recommendFlow.reverting") : t("recommendFlow.revert") }}
              </button>
            </li>
          </ol>
          <p class="flow-history__hint">
            {{ t("recommendFlow.revertHint") }}
          </p>
        </div>

        <FlowCanvas
          v-if="hasActions"
          ref="flowCanvasRef"
          :steps="steps"
          :editable="isEditMode"
          @update:dirty="canvasDirty = $event"
          @update:saving="canvasSaving = $event"
        />
        <p v-else class="modal__empty">{{ t("recommendFlow.noResults") }}</p>

        <p v-if="pipeline.recommendation?.recommendation?.notes" class="flow-notes">
          <strong>{{ t("common.notesLabel") }}</strong> {{ pipeline.recommendation.recommendation.notes }}
        </p>
      </div>
    </div>
  </div>
</template>
