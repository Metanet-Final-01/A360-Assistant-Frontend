<script setup>
import { ref } from "vue";

const props = defineProps({
  actions: { type: Array, required: true },
  depth: { type: Number, default: 0 },
});
const emit = defineEmits(["changed"]);

const dragIndex = ref(null);
const openMenuId = ref(null);
const editingIndex = ref(null);
const editForm = ref({ label: "", rationale: "" });

function confidenceClass(confidence) {
  if (confidence == null) return "";
  if (confidence >= 0.9) return "confidence-badge--high";
  if (confidence >= 0.8) return "confidence-badge--mid";
  return "confidence-badge--low";
}

function onDragStart(index, event) {
  dragIndex.value = index;
  event.dataTransfer.effectAllowed = "move";
}

function onDrop(index) {
  if (dragIndex.value === null || dragIndex.value === index) return;
  const [moved] = props.actions.splice(dragIndex.value, 1);
  props.actions.splice(index, 0, moved);
  dragIndex.value = null;
  emit("changed", "액션 순서 변경");
}

function onDragEnd() {
  dragIndex.value = null;
}

function toggleMenu(index, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === index ? null : index;
}

function closeMenuOnOutsideClick(event) {
  if (openMenuId.value !== null && !event.target.closest(".flow-card__menu-wrap")) {
    openMenuId.value = null;
  }
}

function startEdit(index) {
  openMenuId.value = null;
  editingIndex.value = index;
  editForm.value = {
    label: props.actions[index].label ?? "",
    rationale: props.actions[index].rationale ?? "",
  };
}

function cancelEdit() {
  editingIndex.value = null;
}

function saveEdit(index) {
  props.actions[index].label = editForm.value.label;
  props.actions[index].rationale = editForm.value.rationale;
  editingIndex.value = null;
  emit("changed", "액션 내용 수정");
}

function removeAction(index) {
  openMenuId.value = null;
  if (editingIndex.value === index) editingIndex.value = null;
  props.actions.splice(index, 1);
  emit("changed", "액션 삭제");
}

function onChildChanged(summary) {
  emit("changed", summary);
}
</script>

<template>
  <ol class="flow-action-list" @click="closeMenuOnOutsideClick">
    <li
      v-for="(action, idx) in actions"
      :key="idx"
      class="flow-action"
      :class="{ 'flow-action--dragging': dragIndex === idx }"
      draggable="true"
      @dragstart="onDragStart(idx, $event)"
      @dragover.prevent
      @drop="onDrop(idx)"
      @dragend="onDragEnd"
    >
      <div class="flow-action__row">
        <div class="flow-action__handle" aria-hidden="true" title="드래그해서 순서 변경">⠿</div>

        <div class="flow-action__content">
          <template v-if="editingIndex === idx">
            <div class="flow-card__edit-grid">
              <label>
                <span>라벨</span>
                <input v-model="editForm.label" type="text" />
              </label>
              <label class="flow-card__edit-wide">
                <span>왜 이 액션?</span>
                <input v-model="editForm.rationale" type="text" />
              </label>
            </div>
            <div class="flow-card__actions">
              <button type="button" class="btn btn--outline" @click="cancelEdit">취소</button>
              <button type="button" class="btn btn--primary" @click="saveEdit(idx)">저장</button>
            </div>
          </template>

          <template v-else>
            <header class="flow-action__header">
              <h4>{{ action.order }}. {{ action.label || action.action }}</h4>
              <span
                v-if="action.confidence != null"
                class="confidence-badge"
                :class="confidenceClass(action.confidence)"
              >
                신뢰도 {{ action.confidence.toFixed(2) }}
              </span>
            </header>
            <p class="flow-action__package">{{ action.package }} : {{ action.action }}</p>

            <dl v-if="action.parameters?.length" class="flow-action__params">
              <div v-for="p in action.parameters" :key="p.name">
                <dt>{{ p.label || p.name }}</dt>
                <dd>{{ p.value ?? "—" }}</dd>
              </div>
            </dl>

            <details v-if="action.rationale" class="flow-action__rationale">
              <summary>왜 이 액션?</summary>
              <p>{{ action.rationale }}</p>
              <ul v-if="action.sources?.length" class="flow-action__sources">
                <li v-for="(s, i) in action.sources" :key="i">{{ s.title }}</li>
              </ul>
            </details>
          </template>
        </div>

        <div v-if="editingIndex !== idx" class="flow-card__menu-wrap">
          <button
            type="button"
            class="flow-card__menu-btn"
            aria-label="액션 옵션"
            @click="toggleMenu(idx, $event)"
          >
            &#8942;
          </button>
          <Transition name="fade-up">
            <div v-if="openMenuId === idx" class="flow-card__menu" role="menu">
              <button type="button" role="menuitem" @click="startEdit(idx)">수정</button>
              <button type="button" role="menuitem" class="flow-card__menu-danger" @click="removeAction(idx)">
                삭제
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <FlowActionNode
        v-if="action.children?.length"
        :actions="action.children"
        :depth="depth + 1"
        class="flow-action__children"
        @changed="onChildChanged"
      />
    </li>
  </ol>
</template>
