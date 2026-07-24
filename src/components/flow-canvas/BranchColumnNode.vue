<script setup>
// Vue Flow 노드 타입 'branchColumn' — 분기 세트 안의 컬럼 하나(Try 칸, Catch 칸 …).
// 역할이 고정된 구조 노드라 개별로는 드래그 불가(FlowCanvas가 draggable:false로 배치) —
// 세트 전체를 옮기려면 BranchSetNode(부모 프레임)를 잡아야 한다.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Handle, Position } from "@vue-flow/core";
import ActionBox from "./ActionBox.vue";
import { LAYOUT } from "../../utils/flowLayout";

const { t } = useI18n();

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});

const roleClass = computed(() => {
  const key = { Try: "try", Catch: "catch", Finally: "finally", Throw: "throw" }[props.data.role];
  return key ? `flow-branch__role--${key}` : "flow-branch__role--cond";
});

const outTop = computed(() => LAYOUT.ROLE_BADGE_H + LAYOUT.NODE_H);
</script>

<template>
  <div class="flow-canvas-node flow-canvas-frame flow-canvas-col" :class="{ 'flow-canvas-col--terminal': data.terminal }">
    <span v-if="data.role" class="flow-branch__role" :class="roleClass">{{ data.role }}</span>
    <div class="flow-canvas-frame__header" :style="{ height: `${LAYOUT.NODE_H}px` }">
      <ActionBox
        :prefix="data.prefix"
        :label="data.label"
        :pkg="data.pkg"
        :color="data.color"
        :is-container="data.isContainer"
        :editable="!!data.editable"
        :confidence="data.confidence"
        :rationale="data.rationale"
        :sources="data.sources"
        @change-action="data.onChangeAction?.($event)"
        @delete="data.onDelete?.()"
      />
    </div>
    <span v-if="data.terminal" class="flow-canvas-col__terminal" :title="t('recommendation.terminalHint')">✕</span>
    <Handle type="source" :position="Position.Bottom" id="out" :style="{ top: `${outTop}px`, bottom: 'auto' }" />
  </div>
</template>
