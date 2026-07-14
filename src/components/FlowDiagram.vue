<script setup>
// 추천 흐름도(steps→actions→children 트리)를 시작→…→완료 다이어그램으로 그린다(요약 보기).
// 흐름도 모달(RecommendationFlowModal)이 쓴다. 상세 파라미터는 생략하고 중첩(분기)만 보여준다.
// 상위 액션의 전역 순번·자식 계층 번호·검수 위반 매칭은 recommendation.js 공용 헬퍼를 쓴다
// (추천 흐름도 상세 패널과 번호·경로가 일치하도록).
import { computed } from "vue";
import FlowSequence from "./FlowSequence.vue";
import { buildPackageColorMap, numberFlowSteps, violationSetByStep } from "../utils/recommendation";

const props = defineProps({
  steps: { type: Array, default: () => [] },
  // 검수 위반 목록(step_id + 스텝 내 상대 location) — 있으면 해당 노드를 강조한다.
  violations: { type: Array, default: () => [] },
});

const packageColor = computed(() => buildPackageColorMap(props.steps));
function colorFor(pkg) {
  return packageColor.value.get(pkg || "미지정") ?? "#888888";
}

const numberedSteps = computed(() => numberFlowSteps(props.steps));
const violationsByStep = computed(() => violationSetByStep(props.violations));
function stepViolations(stepId) {
  return violationsByStep.value.get(stepId) ?? null;
}
</script>

<template>
  <div class="flow-diagram">
    <div class="flow-pill">시작</div>
    <div class="flow-arrow" aria-hidden="true"></div>

    <template v-for="step in numberedSteps" :key="step.key">
      <div class="flow-step-label">{{ step.title }}</div>
      <FlowSequence
        v-if="step.items.length"
        :items="step.items"
        :color-for="colorFor"
        :violation-paths="stepViolations(step.step_id)"
        arrows
      />
      <div v-else class="flow-step-empty">이 단계는 확정된 액션이 없습니다</div>
      <div class="flow-arrow" aria-hidden="true"></div>
    </template>

    <div class="flow-pill">완료</div>
  </div>

  <div v-if="packageColor.size" class="flow-legend">
    <span v-for="[pkg, color] in packageColor" :key="pkg" class="flow-legend__item">
      <i class="flow-legend__swatch" :style="{ background: color }"></i>{{ pkg }}
    </span>
  </div>
</template>
