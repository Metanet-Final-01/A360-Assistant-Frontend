<script setup>
import { computed, reactive, ref } from "vue";
import { reorderWorkflowStep, updateWorkflowStep, deleteWorkflowStep } from "../store/workflow";

const props = defineProps({
  steps: {
    type: Array,
    required: true,
  },
});
defineEmits(["close"]);

const dragIndex = ref(null);
const openMenuId = ref(null);
const editingId = ref(null);
const editForm = reactive({
  title: "",
  action: "",
  package: "",
  inputVar: "",
  outputVar: "",
  evidence: "",
});

function confidenceClass(confidence) {
  if (confidence >= 0.9) return "confidence-badge--high";
  if (confidence >= 0.8) return "confidence-badge--mid";
  return "confidence-badge--low";
}

// action 필드 앞부분("Browser : 요소 클릭" -> "Browser")을 패키지 범주 배지로 보여준다.
const CATEGORY_LABELS = {
  Browser: "브라우저",
  Mouse: "마우스",
  Keyboard: "키보드",
  DataTable: "데이터테이블",
  Excel: "엑셀",
  Mail: "메일",
  Email: "메일",
};

function actionCategory(action) {
  if (!action) return "기타";
  const prefix = action.split(":")[0].trim();
  return CATEGORY_LABELS[prefix] || prefix || "기타";
}

const CATEGORY_PALETTE = [
  { fg: "var(--mid)", bg: "var(--mid-bg)" },
  { fg: "var(--brand-teal-dark)", bg: "var(--brand-teal-light)" },
  { fg: "var(--success)", bg: "var(--success-bg)" },
  { fg: "var(--warning)", bg: "var(--warning-bg)" },
  { fg: "var(--brand-navy)", bg: "var(--bg)" },
];

const categoryColorMap = computed(() => {
  const map = new Map();
  props.steps.forEach((step) => {
    const category = actionCategory(step.action);
    if (!map.has(category)) {
      map.set(category, CATEGORY_PALETTE[map.size % CATEGORY_PALETTE.length]);
    }
  });
  return map;
});

function categoryStyle(action) {
  const category = actionCategory(action);
  const style = categoryColorMap.value.get(category) || CATEGORY_PALETTE[0];
  return { color: style.fg, background: style.bg };
}

function onDragStart(index, event) {
  dragIndex.value = index;
  event.dataTransfer.effectAllowed = "move";
}

function onDrop(index) {
  if (dragIndex.value === null || dragIndex.value === index) return;
  reorderWorkflowStep(dragIndex.value, index);
  dragIndex.value = null;
}

function onDragEnd() {
  dragIndex.value = null;
}

function toggleMenu(id, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === id ? null : id;
}

function closeMenuOnOutsideClick(event) {
  if (openMenuId.value && !event.target.closest(".flow-card__menu-wrap")) {
    openMenuId.value = null;
  }
}

function startEdit(step) {
  openMenuId.value = null;
  editingId.value = step.id;
  editForm.title = step.title;
  editForm.action = step.action;
  editForm.package = step.package;
  editForm.inputVar = step.inputVar;
  editForm.outputVar = step.outputVar;
  editForm.evidence = step.evidence;
}

function cancelEdit() {
  editingId.value = null;
}

function saveEdit(id) {
  updateWorkflowStep(id, { ...editForm });
  editingId.value = null;
}

function removeStep(id) {
  openMenuId.value = null;
  if (editingId.value === id) editingId.value = null;
  deleteWorkflowStep(id);
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title">
      <header class="modal__header">
        <h2 id="flow-modal-title">추천 작업 흐름도</h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow" @click="closeMenuOnOutsideClick">
        <template v-if="steps.length">
          <p class="flow-hint">카드를 드래그해 순서를 바꾸고, 점 3개 메뉴에서 수정·삭제할 수 있습니다.</p>

          <div class="flow-diagram">
            <div class="flow-pill">시작</div>
            <div class="flow-arrow" aria-hidden="true"></div>

            <ol class="flow-list">
              <li
                v-for="(step, idx) in steps"
                :key="step.id"
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
                    <template v-if="editingId === step.id">
                      <div class="flow-card__edit-grid">
                        <label>
                          <span>제목</span>
                          <input v-model="editForm.title" type="text" />
                        </label>
                        <label>
                          <span>추천 액션</span>
                          <input v-model="editForm.action" type="text" />
                        </label>
                        <label>
                          <span>필요 패키지</span>
                          <input v-model="editForm.package" type="text" />
                        </label>
                        <label>
                          <span>입력 변수</span>
                          <input v-model="editForm.inputVar" type="text" />
                        </label>
                        <label>
                          <span>출력 변수</span>
                          <input v-model="editForm.outputVar" type="text" />
                        </label>
                        <label class="flow-card__edit-wide">
                          <span>근거</span>
                          <input v-model="editForm.evidence" type="text" />
                        </label>
                      </div>
                      <div class="flow-card__actions">
                        <button type="button" class="btn btn--outline" @click="cancelEdit">취소</button>
                        <button type="button" class="btn btn--primary" @click="saveEdit(step.id)">저장</button>
                      </div>
                    </template>

                    <template v-else>
                      <header class="flow-card__header">
                        <h3>{{ step.stepNo }}. {{ step.title }}</h3>
                        <span class="flow-card__category-badge" :style="categoryStyle(step.action)">
                          {{ actionCategory(step.action) }}
                        </span>
                      </header>
                      <p class="flow-card__action">{{ step.action }}</p>
                      <dl class="flow-card__meta">
                        <div>
                          <dt>필요 패키지</dt>
                          <dd>{{ step.package }}</dd>
                        </div>
                        <div>
                          <dt>입력 변수</dt>
                          <dd>{{ step.inputVar }}</dd>
                        </div>
                        <div>
                          <dt>출력 변수</dt>
                          <dd>{{ step.outputVar }}</dd>
                        </div>
                      </dl>
                      <p class="flow-card__evidence">근거 : {{ step.evidence }}</p>
                    </template>
                  </div>

                  <div v-if="editingId !== step.id" class="flow-card__top-right">
                    <span class="confidence-badge" :class="confidenceClass(step.confidence)">
                      신뢰도 {{ step.confidence.toFixed(2) }}
                    </span>
                    <div class="flow-card__menu-wrap">
                      <button
                        type="button"
                        class="flow-card__menu-btn"
                        aria-label="단계 옵션"
                        @click="toggleMenu(step.id, $event)"
                      >
                        &#8942;
                      </button>
                      <Transition name="fade-up">
                        <div v-if="openMenuId === step.id" class="flow-card__menu" role="menu">
                          <button type="button" role="menuitem" @click="startEdit(step)">수정</button>
                          <button
                            type="button"
                            role="menuitem"
                            class="flow-card__menu-danger"
                            @click="removeStep(step.id)"
                          >
                            삭제
                          </button>
                        </div>
                      </Transition>
                    </div>
                  </div>
                </div>

                <div v-if="idx < steps.length - 1" class="flow-card__connector" aria-hidden="true"></div>
              </li>
            </ol>

            <div class="flow-arrow" aria-hidden="true"></div>
            <div class="flow-pill">완료</div>
          </div>

          <div class="flow-legend">
            <span class="flow-legend__label">패키지:</span>
            <span
              v-for="[category, style] in categoryColorMap"
              :key="category"
              class="flow-legend__badge"
              :style="{ color: style.fg, background: style.bg }"
            >
              {{ category }}
            </span>
          </div>
        </template>

        <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>
      </div>
    </div>
  </div>
</template>
