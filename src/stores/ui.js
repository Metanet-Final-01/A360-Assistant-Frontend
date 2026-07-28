import { defineStore } from "pinia";
import { ref } from "vue";

// 분석 결과 패널의 활성 탭 — 패널 자신뿐 아니라 상단 헤더의 단계 내비("분석 결과"·"추천")도
// 이 값을 바꾸므로, 컴포넌트 로컬 ref가 아니라 공유 스토어에 둔다.
// 값: summary | steps | systems | io | evidence | flow (AnalysisPanel.vue의 TABS와 일치)
export const ANALYSIS_TABS = ["summary", "steps", "systems", "io", "evidence", "flow"];

export const useUiStore = defineStore("ui", () => {
  const analysisTab = ref("summary");

  function setAnalysisTab(tab) {
    if (ANALYSIS_TABS.includes(tab)) analysisTab.value = tab;
  }

  return { analysisTab, setAnalysisTab };
});
