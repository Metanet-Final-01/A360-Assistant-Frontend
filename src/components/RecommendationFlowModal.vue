<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { formatDateShort } from "../utils/dateFormat";
import FlowCanvas from "./flow-canvas/FlowCanvas.vue";

const pipeline = usePipelineStore();
const { t } = useI18n();

defineEmits(["close"]);

// steps→actions→children 트리를 FlowCanvas가 분기 컬럼·중첩 그대로 그린다(Vue Flow 캔버스,
// 확대/축소·팬·텍스트 편집·드래그 재정렬 가능). 편집은 캔버스 안의 로컬 버퍼에만 쌓이고,
// 아래 저장 버튼을 눌러야 새 버전으로 저장된다.
const steps = computed(() => pipeline.recommendation?.recommendation?.steps ?? []);
const hasActions = computed(() => steps.value.some((s) => (s.actions?.length ?? 0) > 0));

const flowCanvasRef = ref(null);
const canvasDirty = ref(false);
const canvasSaving = ref(false);

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
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="rec-flow-modal-title">
      <header class="modal__header">
        <h2 id="rec-flow-modal-title">
          {{ t("recommendFlow.title") }}
          <span v-if="pipeline.recommendation?.version" class="flow-version-badge">
            v{{ pipeline.recommendation.version }}
          </span>
        </h2>
        <button type="button" class="modal__close" :aria-label="t('common.close')" @click="$emit('close')">✕</button>
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
