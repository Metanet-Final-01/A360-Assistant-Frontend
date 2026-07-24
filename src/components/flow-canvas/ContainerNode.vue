<script setup>
// Vue Flow 노드 타입 'container' — Loop/Step-with-children/단독 If 같은 단일 컨테이너.
// 자기 자신은 프레임(테두리·배경)과 상단 헤더(ActionBox)만 그린다 — 자식들은 FlowCanvas가
// 별도의 절대좌표 노드로 얹는다(이 컴포넌트는 프레임 크롬만 담당).
import { Handle, Position } from "@vue-flow/core";
import ActionBox from "./ActionBox.vue";
import { LAYOUT } from "../../utils/flowLayout";

defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});
</script>

<template>
  <div class="flow-canvas-node flow-canvas-frame flow-canvas-frame--container">
    <div class="flow-canvas-frame__header" :style="{ height: `${LAYOUT.NODE_H}px` }">
      <ActionBox
        :prefix="data.prefix"
        :label="data.label"
        :pkg="data.pkg"
        :color="data.color"
        :is-container="true"
        :editable="!!data.editable"
        :confidence="data.confidence"
        :rationale="data.rationale"
        :sources="data.sources"
        @change-action="data.onChangeAction?.($event)"
        @delete="data.onDelete?.()"
      />
    </div>
    <Handle type="target" :position="Position.Top" id="in" />
    <Handle type="source" :position="Position.Bottom" id="out" :style="{ top: `${LAYOUT.NODE_H}px`, bottom: 'auto' }" />
  </div>
</template>
