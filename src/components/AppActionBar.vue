<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { useUiStore } from "../stores/ui";
import { useRecommendationExport } from "../composables/useRecommendationExport";

// 본문 그리드 아래 전체 폭 액션 바 — 결과물에 대한 두 가지 마무리 동작(내보내기 / 추천
// 흐름도로 진행)을 담당한다.
const pipeline = usePipelineStore();
const ui = useUiStore();
const { t } = useI18n();

const { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx } =
  useRecommendationExport();

const hasSteps = computed(() => (pipeline.analysis?.steps ?? []).length > 0);

// "다음" 버튼이 할 수 있는 일: 흐름도가 아직 없으면 생성, 이미 있으면 별도 창으로 열기.
// 분석이 단계를 못 찾은 텍스트 업로드라도 챗봇 대화로 흐름도가 만들어져 있을 수 있어
// recommendation 유무도 함께 본다.
const canGoNext = computed(
  () => (pipeline.analysisStatus === "done" && hasSteps.value) || !!pipeline.recommendation,
);
const isGenerating = computed(
  () => pipeline.recommendStatus === "generating" || pipeline.liveActive,
);

const nextLabel = computed(() => {
  if (isGenerating.value) return t("actionBar.generating");
  return pipeline.recommendStatus === "done" ? t("recommendDetail.viewFlow") : t("actionBar.next");
});

async function goNext() {
  ui.setAnalysisTab("flow");
  if (pipeline.recommendStatus === "done") {
    const url = `/flow-window.html?session=${encodeURIComponent(pipeline.sessionId)}`;
    window.open(url, `a360-flow-${pipeline.sessionId}`, "width=1280,height=860,resizable=yes,noopener");
    return;
  }
  await pipeline.startRecommend();
}

const exportMenuOpen = ref(false);

async function runExport(fn) {
  exportMenuOpen.value = false;
  await fn();
}

function closeExportMenu(event) {
  if (!exportMenuOpen.value) return;
  if (!(event.target instanceof Element) || !event.target.closest(".action-bar__export")) {
    exportMenuOpen.value = false;
  }
}

function closeExportMenuOnEscape(event) {
  if (exportMenuOpen.value && event.key === "Escape") exportMenuOpen.value = false;
}

onMounted(() => {
  window.addEventListener("pointerdown", closeExportMenu);
  window.addEventListener("keydown", closeExportMenuOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeExportMenu);
  window.removeEventListener("keydown", closeExportMenuOnEscape);
});
</script>

<template>
  <div class="action-bar">
    <p v-if="exportError" class="action-bar__error" role="alert">{{ exportError }}</p>

    <div class="action-bar__right">
      <div class="action-bar__export">
        <button
          type="button"
          class="btn btn--outline"
          :disabled="!canExport"
          :title="canExport ? t('recommendDetail.exportTitle') : t('header.exportDisabledHint')"
          :aria-expanded="exportMenuOpen"
          aria-haspopup="menu"
          @click="exportMenuOpen = !exportMenuOpen"
        >
          {{ t("recommendDetail.exportTitle") }}
          <svg class="action-bar__chevron" :class="{ 'action-bar__chevron--open': exportMenuOpen }" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <Transition name="fade-up">
          <div v-if="exportMenuOpen" class="action-bar__menu" role="menu">
            <button type="button" role="menuitem" class="action-bar__menu-item" @click="runExport(downloadJson)">
              {{ t("recommendDetail.exportJson") }}
            </button>
            <button type="button" role="menuitem" class="action-bar__menu-item" @click="runExport(downloadMarkdown)">
              {{ t("recommendDetail.exportMarkdown") }}
            </button>
            <button type="button" role="menuitem" class="action-bar__menu-item" @click="runExport(downloadDocx)">
              {{ t("recommendDetail.exportDocx") }}
            </button>
          </div>
        </Transition>
      </div>

      <button
        type="button"
        class="btn btn--primary action-bar__next"
        :disabled="!canGoNext || isGenerating"
        @click="goNext"
      >
        {{ nextLabel }} <span aria-hidden="true">→</span>
      </button>
    </div>
  </div>
</template>
