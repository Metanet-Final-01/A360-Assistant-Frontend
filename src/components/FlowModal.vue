<script setup>
defineProps({
  steps: {
    type: Array,
    required: true,
  },
});
defineEmits(["close"]);

const BOX_HEIGHT = 74;
const GAP = 46;
const BOX_WIDTH = 420;
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title">
      <header class="modal__header">
        <h2 id="flow-modal-title">추천 작업 흐름도</h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body">
        <svg
          v-if="steps.length"
          :viewBox="`0 0 ${BOX_WIDTH + 40} ${steps.length * (BOX_HEIGHT + GAP)}`"
          class="flow-svg"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="var(--brand-teal-dark)" />
            </marker>
          </defs>

          <g v-for="(step, idx) in steps" :key="step.id">
            <rect
              x="20"
              :y="idx * (BOX_HEIGHT + GAP) + 10"
              :width="BOX_WIDTH"
              :height="BOX_HEIGHT"
              rx="10"
              fill="var(--surface)"
              stroke="var(--border)"
            />
            <text
              x="40"
              :y="idx * (BOX_HEIGHT + GAP) + 36"
              class="flow-svg__title"
            >{{ step.stepNo }}. {{ step.title }}</text>
            <text
              x="40"
              :y="idx * (BOX_HEIGHT + GAP) + 60"
              class="flow-svg__subtitle"
            >{{ step.action }}</text>

            <line
              v-if="idx < steps.length - 1"
              :x1="20 + BOX_WIDTH / 2"
              :y1="idx * (BOX_HEIGHT + GAP) + 10 + BOX_HEIGHT"
              :x2="20 + BOX_WIDTH / 2"
              :y2="(idx + 1) * (BOX_HEIGHT + GAP) + 10"
              stroke="var(--brand-teal-dark)"
              stroke-width="2"
              marker-end="url(#arrow)"
            />
          </g>
        </svg>
        <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>
      </div>
    </div>
  </div>
</template>
