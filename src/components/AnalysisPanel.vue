<script setup>
import { computed, defineAsyncComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport } from "../api/recommend";
import { buildPackageColorMap, confidenceBadge, flattenDetailed, formatParamValue, stepLabel } from "../utils/recommendation";

// "흐름도 보기" 버튼을 눌러야만 열리는 모달이라, 분석 페이지 초기 번들에서 빼서
// 실제로 열 때만 내려받는다.
const RecommendationFlowModal = defineAsyncComponent(() => import("./RecommendationFlowModal.vue"));

// 루트 노드가 여러 개(패널 + 로딩 오버레이 + 모달)라 attrs 자동 전달이 안 되므로,
// 패널 재배치용 data-panel-key/order 스타일을 패널 섹션에 직접 물려준다.
defineOptions({ inheritAttrs: false });

const pipeline = usePipelineStore();
const { t } = useI18n();

const showFlowModal = ref(false);

// 업무 단계(WorkStep, schemas/analysis.py) 확인·편집은 업로드 패널로 옮겨졌다 — 여기는
// 흐름도(RecommendedAction, schemas/recommendation.py)만 다룬다. 흐름도 step은 분석 단계와
// 1:1이 아니므로(에이전트가 자유롭게 합치고 쪼갠다), step_id로 분석 결과와 매칭하지 않고
// 흐름도 데이터만으로 독립적으로 렌더한다. "흐름도 추천" 버튼 노출 여부만 분석 완료 여부를 본다.
const hasSteps = computed(() => (pipeline.analysis?.steps ?? []).length > 0);

const packageColor = computed(() => buildPackageColorMap(pipeline.recommendation?.recommendation?.steps));

function colorFor(pkg) {
  return packageColor.value.get(pkg || t("common.unspecified")) ?? "#888888";
}

const recVariables = computed(() => pipeline.recommendation?.recommendation?.variables ?? []);
const inputVars = computed(() => recVariables.value.filter((v) => v.direction === "input"));
const outputVars = computed(() => recVariables.value.filter((v) => v.direction === "output"));

const flowSteps = computed(() => {
  const steps = pipeline.recommendation?.recommendation?.steps ?? [];
  return steps.map((stepRec, idx) => ({
    key: stepRec.step_id ?? idx,
    title: stepLabel(stepRec, idx),
    description: stepRec.description,
    actions: flattenDetailed(stepRec.actions).map((a) => ({ ...a, badge: confidenceBadge(a.confidence) })),
  }));
});

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
    exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
  }
}
</script>

<template>
  <section
    class="panel panel--wide"
    aria-labelledby="analysis-panel-title"
    data-tour="recommend"
    v-bind="$attrs"
  >
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        draggable="true"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="analysis-panel-title">{{ t("recommendDetail.title") }}</h2>
    </header>

    <div class="panel__body">
      <div v-if="pipeline.sessionLoadStatus === 'loading'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ t("recommendDetail.sessionLoadingHint") }}</p>
      </div>

      <div v-else-if="!pipeline.recommendation" class="empty-state">
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

        <div v-for="group in flowSteps" :key="group.key" class="rec-detail__step">
          <h4 class="rec-detail__step-title">{{ group.title }}</h4>
          <p v-if="group.description" class="rec-detail__step-desc">{{ group.description }}</p>

          <div v-for="(a, i) in group.actions" :key="i" class="rec-detail__action">
            <div class="rec-detail__action-header">
              <span class="rec-detail__action-label">{{ a.label }}</span>
              <span class="rec-card__action-chip-package" :style="{ background: colorFor(a.package) }">
                {{ a.package }}
              </span>
              <span
                v-if="a.badge"
                class="confidence-badge"
                :class="`confidence-badge--${a.badge.level}`"
              >
                {{ a.badge.text }}
              </span>
            </div>
            <ul v-if="a.parameters.length" class="rec-detail__params">
              <li v-for="p in a.parameters" :key="p.name">
                <span class="rec-detail__param-name">{{ p.name }}</span>
                <span class="rec-detail__param-value">{{ formatParamValue(p.value) }}</span>
              </li>
            </ul>
          </div>
        </div>

        <p v-if="pipeline.recommendation.recommendation?.notes" class="flow-notes">
          <strong>{{ t("common.notesLabel") }}</strong> {{ pipeline.recommendation.recommendation.notes }}
        </p>
      </div>
    </div>

    <div v-if="pipeline.analysisStatus === 'done' && hasSteps" class="panel__footer">
      <div class="recommend-section">
        <h3 class="export-section__title">{{ t("recommendDetail.recommendSectionTitle") }}</h3>

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
            {{ pipeline.recommendStatus === "generating" ? t("recommendDetail.generating") : t("recommendDetail.viewFlow") }}
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
        <h3 class="export-section__title">{{ t("recommendDetail.exportTitle") }}</h3>
        <div class="export-section__actions">
          <button
            type="button"
            class="btn btn--outline"
            :disabled="!canExport"
            :title="canExport ? '' : t('recommendDetail.exportDisabledHint')"
            @click="downloadJson"
          >
            {{ t("recommendDetail.exportJson") }}
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
        <p>{{ t("recommendDetail.generatingModal") }}</p>
      </div>
    </div>
  </div>

  <RecommendationFlowModal v-if="showFlowModal" @close="showFlowModal = false" />
</template>
