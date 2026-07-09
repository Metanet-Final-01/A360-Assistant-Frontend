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
const editForm = ref({ package: "", action: "", label: "", rationale: "" });

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
    package: props.actions[index].package ?? "",
    action: props.actions[index].action ?? "",
    label: props.actions[index].label ?? "",
    rationale: props.actions[index].rationale ?? "",
  };
}

function cancelEdit() {
  // 방금 "+ 액션 추가"로 만든, 아직 아무것도 채우지 않은 액션이면 취소 시 함께 지운다(addAction의 기본값과 동일한 경우).
  if (editingIndex.value !== null) {
    const draft = props.actions[editingIndex.value];
    if (draft && !draft.package && !draft.action && draft.label === "새 액션") {
      props.actions.splice(editingIndex.value, 1);
    }
  }
  editingIndex.value = null;
}

function saveEdit(index) {
  props.actions[index].package = editForm.value.package;
  props.actions[index].action = editForm.value.action;
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

function addAction() {
  const nextOrder = (props.actions[props.actions.length - 1]?.order ?? 0) + 1;
  props.actions.push({
    order: nextOrder,
    package: "",
    action: "",
    label: "새 액션",
    parameters: [],
    children: [],
    rationale: null,
    sources: [],
    confidence: null,
  });
  startEdit(props.actions.length - 1);
}

function onChildChanged(summary) {
  emit("changed", summary);
}

// 액션 자체 정보만으로 입력 변수 칸을 채운다 (분석 단계의 입력/출력과는 별개).
function parameterSummary(action) {
  if (!action.parameters?.length) return "—";
  return action.parameters.map((p) => `${p.label || p.name}: ${p.value ?? "—"}`).join(", ");
}
</script>

<template>
  <div class="flow-action-node">
    <ol class="flow-list" @click="closeMenuOnOutsideClick">
      <li
        v-for="(action, idx) in actions"
        :key="idx"
        class="flow-card"
        :class="{ 'flow-card--dragging': dragIndex === idx }"
        draggable="true"
        @dragstart="onDragStart(idx, $event)"
        @dragover.prevent
        @drop="onDrop(idx)"
        @dragend="onDragEnd"
      >
        <div class="flow-card__row">
          <div class="flow-card__handle" aria-hidden="true" title="드래그해서 순서 변경">⠿</div>

          <div class="flow-card__content">
            <template v-if="editingIndex === idx">
              <div class="flow-card__edit-grid">
                <label>
                  <span>패키지</span>
                  <input v-model="editForm.package" type="text" placeholder="예: Excel_MS" />
                </label>
                <label>
                  <span>액션</span>
                  <input v-model="editForm.action" type="text" placeholder="예: GoToCell" />
                </label>
                <label class="flow-card__edit-wide">
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
              <header class="flow-card__header">
                <h3>{{ action.order }}. {{ action.label || action.action }}</h3>
              </header>

              <dl class="flow-card__meta">
                <div>
                  <dt>필요 패키지</dt>
                  <dd>{{ action.package || "—" }}</dd>
                </div>
                <div>
                  <dt>입력 변수</dt>
                  <dd>{{ parameterSummary(action) }}</dd>
                </div>
              </dl>

              <p v-if="action.rationale" class="flow-card__evidence">근거 : {{ action.rationale }}</p>
              <ul v-if="action.sources?.length" class="flow-action__sources">
                <li v-for="(s, i) in action.sources" :key="i">{{ s.title }}</li>
              </ul>
            </template>
          </div>

          <div class="flow-card__top-right">
            <span
              v-if="editingIndex !== idx && action.confidence != null"
              class="confidence-badge"
              :class="confidenceClass(action.confidence)"
            >
              신뢰도 {{ action.confidence.toFixed(2) }}
            </span>
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
        </div>

        <div v-if="idx < actions.length - 1" class="flow-card__connector" aria-hidden="true"></div>

        <FlowActionNode
          v-if="action.children?.length"
          :actions="action.children"
          :depth="depth + 1"
          class="flow-action__children"
          @changed="onChildChanged"
        />
      </li>
    </ol>

    <button type="button" class="flow-add-btn" @click="addAction">+ 액션 추가</button>
  </div>
</template>
