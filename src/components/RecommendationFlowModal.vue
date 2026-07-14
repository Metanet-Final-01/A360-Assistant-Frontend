<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { formatDateShort } from "../utils/dateFormat";
import FlowDiagram from "./FlowDiagram.vue";

const pipeline = usePipelineStore();
const { t } = useI18n();

defineEmits(["close"]);

// steps→actions→children 트리를 FlowDiagram이 분기 컬럼·중첩 그대로 그린다(요약 보기).
const steps = computed(() => pipeline.recommendation?.recommendation?.steps ?? []);
const hasActions = computed(() => steps.value.some((s) => (s.actions?.length ?? 0) > 0));

// ----- 버전 이력 -----
// 순서변경·수정·삭제·추가는 분석 결과 패널의 업무 단계 카드에서 하므로, 여기는 읽기 전용 보기다.
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
          <p class="flow-hint">{{ t("recommendFlow.hint") }}</p>
          <div class="flow-toolbar__actions">
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

        <FlowDiagram v-if="hasActions" :steps="steps" />
        <p v-else class="modal__empty">{{ t("recommendFlow.noResults") }}</p>

        <p v-if="pipeline.recommendation?.recommendation?.notes" class="flow-notes">
          <strong>{{ t("common.notesLabel") }}</strong> {{ pipeline.recommendation.recommendation.notes }}
        </p>
      </div>
    </div>
  </div>
</template>
