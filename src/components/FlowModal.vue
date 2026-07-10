<script setup>
import { computed } from "vue";

// 아카이브 상세의 읽기 전용 흐름도 뷰어 — 세션의 최신 Recommendation 트리
// (steps→actions→children)를 RecommendationFlowModal 보기 모드와 같은
// 박스 다이어그램으로 그린다. (과거의 flat 목업 steps 렌더는 실연동으로 제거됨)
const props = defineProps({
  recommendation: { type: Object, default: null }, // Recommendation 트리 {steps, variables, notes}
  version: { type: Number, default: null },
});
defineEmits(["close"]);

// 패키지별 색상은 고정 매핑이 아니라, 이 추천안에 등장한 패키지 순서대로 팔레트를 배정한다.
const PALETTE = ["#1f6f8b", "#7c5cbf", "#b7791f", "#1f9d55", "#d84a3a", "#2f6fa8", "#a8447a", "#55607a"];

const packageColor = computed(() => {
  const map = new Map();
  function walk(actions) {
    (actions ?? []).forEach((a) => {
      const key = a.package || "미지정";
      if (!map.has(key)) map.set(key, PALETTE[map.size % PALETTE.length]);
      if (a.children?.length) walk(a.children);
    });
  }
  (props.recommendation?.steps ?? []).forEach((stepRec) => walk(stepRec.actions));
  return map;
});

function colorFor(pkg) {
  return packageColor.value.get(pkg || "미지정") ?? "#888888";
}

// 업무 단계 구분 없이 모든 액션(중첩 포함)을 순서대로 박스 하나씩으로 펼친 단일 시퀀스.
const actionBoxes = computed(() => {
  const boxes = [];
  let seq = 0;
  function walk(actions) {
    (actions ?? []).forEach((a) => {
      seq += 1;
      boxes.push({ seq, label: a.label || a.action, package: a.package || "미지정" });
      if (a.children?.length) walk(a.children);
    });
  }
  (props.recommendation?.steps ?? []).forEach((stepRec) => walk(stepRec.actions));
  return boxes;
});
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title">
      <header class="modal__header">
        <h2 id="flow-modal-title">
          자동화 흐름도
          <span v-if="version" class="flow-version-badge">v{{ version }}</span>
        </h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow">
        <p class="flow-hint">이 세션에 저장된 최신 추천 흐름도입니다.</p>

        <template v-if="actionBoxes.length">
          <div class="flow-diagram">
            <div class="flow-pill">시작</div>
            <div class="flow-arrow" aria-hidden="true"></div>

            <template v-for="(box, idx) in actionBoxes" :key="box.seq">
              <div class="flow-box">
                <span class="flow-box__label">S{{ box.seq }}. {{ box.label }}</span>
                <span class="flow-box__tag" :style="{ background: colorFor(box.package) }">{{ box.package }}</span>
              </div>
              <div v-if="idx < actionBoxes.length - 1" class="flow-arrow" aria-hidden="true"></div>
            </template>

            <div class="flow-arrow" aria-hidden="true"></div>
            <div class="flow-pill">완료</div>
          </div>

          <div class="flow-legend">
            <span v-for="[pkg, color] in packageColor" :key="pkg" class="flow-legend__item">
              <i class="flow-legend__swatch" :style="{ background: color }"></i>{{ pkg }}
            </span>
          </div>
        </template>
        <p v-else class="modal__empty">이 세션에는 저장된 흐름도가 없습니다.</p>

        <p v-if="recommendation?.notes" class="flow-notes">
          <strong>참고:</strong> {{ recommendation.notes }}
        </p>
      </div>
    </div>
  </div>
</template>
