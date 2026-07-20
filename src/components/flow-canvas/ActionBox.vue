<script setup>
// Vue Flow 캔버스의 액션 "박스" — action/container/branchColumn 세 노드 타입이 공통으로 쓰는
// 프레젠테이션 컴포넌트. 더블클릭 또는 연필 버튼으로 라벨을 인라인 편집한다.
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  prefix: { type: String, default: "" },
  label: { type: String, default: "" },
  pkg: { type: String, default: "" },
  color: { type: String, default: "#888888" },
  isContainer: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
});

const emit = defineEmits(["commit"]);

const editing = ref(false);
const draft = ref("");
const inputRef = ref(null);

function startEdit() {
  if (!props.editable || editing.value) return;
  draft.value = props.label;
  editing.value = true;
  nextTick(() => inputRef.value?.focus());
}

function commit() {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value.trim();
  if (next && next !== props.label) emit("commit", next);
}

function cancel() {
  editing.value = false;
}
</script>

<template>
  <div class="flow-box flow-canvas-box" :class="{ 'flow-box--container': isContainer }">
    <template v-if="!editing">
      <span class="flow-canvas-box__row" :title="label" @dblclick.stop="startEdit">
        <span v-if="prefix" class="flow-node__num">{{ prefix }}</span>
        <span class="flow-canvas-box__text">{{ label }}</span>
        <span class="flow-box__tag" :style="{ background: color }">{{ pkg }}</span>
      </span>
      <button
        v-if="editable"
        type="button"
        class="flow-canvas-box__edit-btn nodrag nopan"
        :title="t('recommendFlow.editTextTitle')"
        :aria-label="t('recommendFlow.editTextTitle')"
        @pointerdown.stop
        @click.stop="startEdit"
      >
        ✎
      </button>
    </template>
    <textarea
      v-else
      ref="inputRef"
      v-model="draft"
      class="flow-canvas-box__input nodrag nopan"
      rows="2"
      @pointerdown.stop
      @keydown.enter.exact.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    ></textarea>
  </div>
</template>
