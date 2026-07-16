<script setup>
// Vue Flow 노드 타입 'branchSet' — Try/Catch/Finally 또는 If/ElseIf/Else 세트 전체를 감싸는
// 바깥 프레임 + 라벨 필. 세트 전체가 하나의 이동 단위(드래그 가능) — 개별 컬럼은 여기 안 들어있고
// FlowCanvas가 별도 'branchColumn' 노드로 얹는다(이 컴포넌트는 프레임 크롬만).
import { Handle, Position } from "@vue-flow/core";

defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});
</script>

<template>
  <div class="flow-canvas-node flow-canvas-frame flow-canvas-frame--branch-set">
    <span class="flow-branch__label flow-canvas-frame__label">{{ data.label }}</span>
    <Handle type="target" :position="Position.Top" id="in" />
  </div>
</template>
