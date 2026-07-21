<script setup>
// Vue Flow 캔버스의 액션 "박스" — action/container/branchColumn 세 노드 타입이 공통으로 쓰는
// 프레젠테이션 컴포넌트. 더블클릭 또는 연필 버튼으로 라벨을 인라인 편집한다.
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  prefix: { type: String, default: "" },
  label: { type: String, default: "" },
  pkg: { type: String, default: "" },
  color: { type: String, default: "#888888" },
  isContainer: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  // FR-11/FR-12 — 백엔드가 액션마다 내려주는 근거 문장·RAG 출처·신뢰도(0~1). 컨테이너 헤더
  // (Loop/Step 등)에는 보통 없어 배지·근거 버튼이 자연히 숨는다.
  confidence: { type: Number, default: null },
  rationale: { type: String, default: "" },
  sources: { type: Array, default: () => [] },
});

const emit = defineEmits(["commit"]);

const editing = ref(false);
const draft = ref("");
const inputRef = ref(null);

const hasEvidence = computed(() => !!props.rationale || props.sources.length > 0);
const evidenceOpen = ref(false);
const confidenceTier = computed(() => {
  if (props.confidence == null) return null;
  return props.confidence >= 0.7 ? "high" : props.confidence >= 0.4 ? "mid" : "low";
});

function toggleEvidence() {
  evidenceOpen.value = !evidenceOpen.value;
}

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
        <span
          v-if="confidenceTier"
          class="flow-box__confidence"
          :class="`flow-box__confidence--${confidenceTier}`"
          :title="t('recommendDetail.confidenceLabel') + ` ${Math.round(confidence * 100)}%`"
        >
          {{ Math.round(confidence * 100) }}%
        </span>
      </span>
      <button
        v-if="hasEvidence"
        type="button"
        class="flow-canvas-box__evidence-btn nodrag nopan"
        :class="{ 'flow-canvas-box__evidence-btn--open': evidenceOpen }"
        :title="t('recommendDetail.rationaleLabel')"
        :aria-label="t('recommendDetail.rationaleLabel')"
        :aria-expanded="evidenceOpen"
        @pointerdown.stop
        @click.stop="toggleEvidence"
      >
        ⓘ
      </button>
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
      <div v-if="hasEvidence && evidenceOpen" class="flow-box__evidence nodrag nopan" @pointerdown.stop>
        <p v-if="rationale" class="flow-box__evidence-rationale">{{ rationale }}</p>
        <ul v-if="sources.length" class="flow-box__evidence-sources">
          <li v-for="(source, idx) in sources" :key="idx">
            <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">
              {{ source.title || source.url }}
            </a>
            <span v-else>{{ source.title || t("chat.untitledSource") }}</span>
            <span v-if="source.score != null" class="flow-box__evidence-score">{{ Number(source.score).toFixed(2) }}</span>
          </li>
        </ul>
      </div>
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
