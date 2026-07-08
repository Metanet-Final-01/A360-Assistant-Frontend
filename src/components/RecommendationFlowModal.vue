<script setup>
import { computed, reactive, ref } from "vue";
import { workflow, saveRecommendationEdit } from "../store/workflow";
import FlowActionNode from "./FlowActionNode.vue";

defineEmits(["close"]);

// 편집용 로컬 복사본 — 저장이 성공하면 workflow.recommendation이 새 트리로 갱신되고,
// 이 모달은 다음에 다시 열릴 때 그 최신 트리를 기준으로 새로 복사한다.
const editedTree = reactive(
  structuredClone(workflow.recommendation?.recommendation ?? { steps: [], variables: [], notes: null }),
);

const stepInfoById = computed(() => {
  const map = new Map();
  (workflow.analysis?.steps ?? []).forEach((s) => map.set(s.step_id, s));
  return map;
});

const isSaving = ref(false);
const saveError = ref("");
let saveTimer = null;

// 드래그 등으로 짧은 시간 안에 여러 번 바뀔 수 있어 살짝 디바운스한 뒤 한 번만 저장한다.
function scheduleSave(changeSummary) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    isSaving.value = true;
    saveError.value = "";
    await saveRecommendationEdit(structuredClone(editedTree), changeSummary);
    if (workflow.recommendStatus === "error") saveError.value = workflow.recommendError;
    isSaving.value = false;
  }, 400);
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="rec-flow-modal-title">
      <header class="modal__header">
        <h2 id="rec-flow-modal-title">
          추천 작업 흐름도
          <span v-if="workflow.recommendation?.version" class="flow-version-badge">
            v{{ workflow.recommendation.version }}
          </span>
        </h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow">
        <p v-if="isSaving" class="flow-save-status">저장 중…</p>
        <p v-else-if="saveError" class="upload-error">{{ saveError }}</p>
        <p class="flow-hint">액션 카드를 드래그해 순서를 바꾸고, 점 3개 메뉴에서 수정·삭제할 수 있습니다.</p>

        <template v-if="editedTree.steps?.length">
          <section v-for="stepRec in editedTree.steps" :key="stepRec.step_id" class="flow-step-group">
            <h3 class="flow-step-group__title">
              {{ stepInfoById.get(stepRec.step_id)?.order ?? "?" }}.
              {{ stepInfoById.get(stepRec.step_id)?.name ?? stepRec.step_id }}
            </h3>
            <FlowActionNode :actions="stepRec.actions" :depth="0" @changed="scheduleSave" />
          </section>
        </template>
        <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>

        <p v-if="editedTree.notes" class="flow-notes"><strong>참고:</strong> {{ editedTree.notes }}</p>
      </div>
    </div>
  </div>
</template>
