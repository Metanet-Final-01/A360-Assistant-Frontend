<script setup>
import { computed, ref } from "vue";
import { workflow, buildExportPayload } from "../store/workflow";
import FlowModal from "./FlowModal.vue";

const TOTAL_STEP_COUNT = 3;
const showFlowModal = ref(false);

const skeletonCount = computed(() => {
  if (workflow.analysisStatus !== "analyzing") return 0;
  return Math.max(TOTAL_STEP_COUNT - workflow.visibleSteps.length, 0);
});

const emptyState = computed(
  () => workflow.analysisStatus === "idle" && workflow.visibleSteps.length === 0,
);

function confidenceClass(confidence) {
  if (confidence >= 0.9) return "confidence-badge--high";
  if (confidence >= 0.8) return "confidence-badge--mid";
  return "confidence-badge--low";
}

function downloadJson() {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "a360-recommendation.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="panel panel--wide" aria-labelledby="analysis-panel-title">
    <header class="panel__header">
      <h2 id="analysis-panel-title">② 분석 결과 &amp; ③ A360 작업 추천</h2>
    </header>

    <div class="panel__body">
      <div v-if="emptyState" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <p>업무정의서를 업로드하고 분석을 시작하면<br />단계별 A360 작업 추천 결과가 여기에 표시됩니다.</p>
      </div>

      <TransitionGroup name="fade-up" tag="div" class="rec-list">
        <article
          v-for="step in workflow.visibleSteps"
          :key="step.id"
          class="rec-card"
        >
          <header class="rec-card__header">
            <h3>{{ step.stepNo }}. {{ step.title }}</h3>
            <span class="confidence-badge" :class="confidenceClass(step.confidence)">
              신뢰도 {{ step.confidence.toFixed(2) }}
            </span>
          </header>

          <div class="rec-card__grid">
            <div class="rec-card__field">
              <span class="rec-card__field-label">추천 액션</span>
              <span class="rec-card__field-value rec-card__field-value--accent">{{ step.action }}</span>
            </div>
            <div class="rec-card__field">
              <span class="rec-card__field-label">필요 패키지</span>
              <span class="rec-card__field-value">{{ step.package }}</span>
            </div>
            <div class="rec-card__field">
              <span class="rec-card__field-label">입력 변수</span>
              <span class="rec-card__field-value">{{ step.inputVar }}</span>
            </div>
            <div class="rec-card__field">
              <span class="rec-card__field-label">출력 변수</span>
              <span class="rec-card__field-value">{{ step.outputVar }}</span>
            </div>
          </div>

          <footer class="rec-card__footer">근거 : {{ step.evidence }}</footer>
        </article>

        <div v-for="n in skeletonCount" :key="`skeleton-${n}`" class="rec-card rec-card--skeleton">
          <div class="skeleton-line skeleton-line--title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line skeleton-line--short"></div>
        </div>
      </TransitionGroup>

      <div class="export-section" v-if="workflow.analysisStatus === 'done'">
        <h3 class="export-section__title">⑤ 내보내기</h3>
        <div class="export-section__actions">
          <button type="button" class="btn btn--outline" @click="downloadJson">
            JSON 다운로드
          </button>
          <button type="button" class="btn btn--outline" @click="showFlowModal = true">
            흐름도 보기
          </button>
        </div>
      </div>
    </div>
  </section>

  <FlowModal
    v-if="showFlowModal"
    :steps="workflow.visibleSteps"
    @close="showFlowModal = false"
  />
</template>
