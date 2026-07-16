<script setup>
// Vue Flow 노드 타입 'label' — 시작/완료 필(variant="pill")과 단계 타이틀(variant="title").
// 순수 표시용, 드래그·편집 불가(FlowCanvas가 draggable:false로 배치).
defineProps({
  data: { type: Object, required: true },
});
</script>

<template>
  <div :class="data.variant === 'pill' ? 'flow-pill flow-canvas-pill' : 'flow-step-label flow-canvas-step-title'">
    {{ data.label }}
  </div>
</template>
