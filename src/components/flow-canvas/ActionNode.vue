<script setup>
// Vue Flow 노드 타입 'action' — 자식 없는 일반 액션(리프). 드래그로 이동 가능.
import { Handle, Position } from "@vue-flow/core";
import ActionBox from "./ActionBox.vue";

defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});
</script>

<template>
  <div class="flow-canvas-node">
    <Handle type="target" :position="Position.Top" id="in" />
    <ActionBox
      :prefix="data.prefix"
      :label="data.label"
      :pkg="data.pkg"
      :color="data.color"
      :is-container="false"
      :editable="!!data.editable"
      :confidence="data.confidence"
      :rationale="data.rationale"
      :sources="data.sources"
      @commit="data.onCommit?.($event)"
    />
    <Handle type="source" :position="Position.Bottom" id="out" />
  </div>
</template>
