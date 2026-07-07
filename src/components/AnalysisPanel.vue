<script setup>
import { computed, ref } from "vue";
import { workflow, buildExportPayload, startAnalysis } from "../store/workflow";
import FlowModal from "./FlowModal.vue";

const showFlowModal = ref(false);

const emptyState = computed(() => workflow.analysisStatus === "idle");

// 흐름도(FlowModal)에서 순서 변경·수정·삭제한 내용이 이 패널에도 그대로 반영되도록
// analysis.steps 원본이 아니라 편집 상태인 workflow.visibleSteps를 그대로 사용한다.
const steps = computed(() => workflow.visibleSteps);
const hasSteps = computed(() => steps.value.length > 0);
const ambiguities = computed(() => workflow.analysis?.ambiguities ?? []);

function downloadJson() {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "a360-analysis.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="panel panel--wide" aria-labelledby="analysis-panel-title">
    <header class="panel__header">
      <h2 id="analysis-panel-title">분석 결과</h2>
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
        <p>업무정의서를 업로드하고 분석을 시작하면<br />단계별 분석 결과가 여기에 표시됩니다.</p>
      </div>

      <div v-else-if="workflow.analysisStatus === 'analyzing'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ workflow.analysisStage || "분석 중…" }}</p>
      </div>

      <div v-else-if="workflow.analysisStatus === 'error'" class="analyzing-state analyzing-state--error">
        <p class="upload-error">{{ workflow.analysisError }}</p>
        <button type="button" class="btn btn--outline" @click="startAnalysis">다시 시도</button>
      </div>

      <template v-else-if="workflow.analysisStatus === 'done'">
        <div class="analysis-summary" v-if="workflow.analysis">
          <h3 v-if="workflow.analysis.document_title">{{ workflow.analysis.document_title }}</h3>
          <p>{{ workflow.analysis.summary }}</p>
        </div>

        <div v-if="!hasSteps" class="empty-state">
          <p>문서에서 분석 가능한 업무 단계를 찾지 못했습니다.</p>
        </div>

        <div v-else class="rec-list">
          <article v-for="step in steps" :key="step.id" class="rec-card">
            <header class="rec-card__header">
              <h3>{{ step.stepNo }}. {{ step.title }}</h3>
            </header>

            <p class="rec-card__description">{{ step.action }}</p>

            <div class="rec-card__grid">
              <div class="rec-card__field">
                <span class="rec-card__field-label">입력</span>
                <span class="rec-card__field-value">{{ step.inputVar }}</span>
              </div>
              <div class="rec-card__field">
                <span class="rec-card__field-label">출력</span>
                <span class="rec-card__field-value">{{ step.outputVar }}</span>
              </div>
              <div class="rec-card__field">
                <span class="rec-card__field-label">연계 시스템</span>
                <span class="rec-card__field-value">{{ step.package }}</span>
              </div>
              <div class="rec-card__field" v-if="step.branching">
                <span class="rec-card__field-label">분기</span>
                <span class="rec-card__field-value">{{ step.branching }}</span>
              </div>
            </div>

            <footer v-if="step.evidence" class="rec-card__footer">근거: {{ step.evidence }}</footer>
          </article>
        </div>

        <div v-if="ambiguities.length" class="ambiguities-section">
          <h3 class="ambiguities-section__title">확인 필요</h3>
          <ul>
            <li v-for="(item, idx) in ambiguities" :key="idx">{{ item }}</li>
          </ul>
        </div>
      </template>

      <div class="export-section" v-if="workflow.analysisStatus === 'done' && hasSteps">
        <h3 class="export-section__title">내보내기</h3>
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
