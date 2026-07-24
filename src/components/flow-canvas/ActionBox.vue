<script setup>
// Vue Flow 캔버스의 액션 "박스" — action/container/branchColumn 세 노드 타입이 공통으로 쓰는
// 프레젠테이션 컴포넌트. 더블클릭 또는 연필 버튼으로 패키지/액션 교체 팝오버(ActionCatalogList)를
// 띄운다 — 예전엔 라벨을 자유 텍스트로 고쳤지만, 이제는 항상 카탈로그에서 골라 바꿔치기한다.
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import ActionCatalogList from "./ActionCatalogList.vue";

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

const emit = defineEmits(["change-action", "delete"]);

const hasEvidence = computed(() => !!props.rationale || props.sources.length > 0);
const evidenceOpen = ref(false);
const confidenceTier = computed(() => {
  if (props.confidence == null) return null;
  return props.confidence >= 0.7 ? "high" : props.confidence >= 0.4 ? "mid" : "low";
});

// 근거 팝오버는 캔버스 노드 트리 안에 그대로 두면 두 가지 문제가 있다 — (1) vue-flow가 각
// 노드 래퍼에 개별 z-index를 인라인으로 매기므로, 뒤에 그려지는 다음 노드가 이 노드의 로컬
// z-index:20보다 실제로는 위에 그려져(스태킹 컨텍스트가 노드 래퍼 z-index에 갇힘) 팝오버
// 꼬리가 다음 노드에 가려진다. (2) .flow-canvas의 overflow:hidden에 걸려 캔버스 뷰포트
// 아래로 잘린다. AppSidebar.vue의 아카이브 메뉴와 동일한 해법 — body로 텔레포트해 모든
// 노드 스태킹 컨텍스트를 완전히 벗어나고, position:fixed 좌표는 열릴 때 버튼 위치
// (getBoundingClientRect, pan/zoom 반영된 실제 화면 좌표)로 계산한다.
const boxRef = ref(null);
const evidenceBtnRef = ref(null);
const evidencePanelRef = ref(null);
const evidenceStyle = ref({});
const EVIDENCE_MARGIN = 8;

function positionEvidence() {
  const anchor = boxRef.value;
  const panel = evidencePanelRef.value;
  if (!anchor || !panel) return;
  const rect = anchor.getBoundingClientRect();
  const container = anchor.closest(".flow-canvas");
  const containerRect = container ? container.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const spaceBelow = containerRect.bottom - rect.bottom - EVIDENCE_MARGIN;
  const spaceAbove = rect.top - containerRect.top - EVIDENCE_MARGIN;
  // scrollHeight로 필요한 높이를 재려면 최종 폭(anchor와 동일)에서 줄바꿈된 상태여야 정확하다 —
  // reactive style을 거치면 다음 틱까지 폭이 안 바뀌어 잘못된 폭 기준으로 재게 되므로, DOM에
  // 직접 폭을 먼저 반영한 뒤 같은 틱에서 측정한다.
  panel.style.width = `${rect.width}px`;
  const panelHeight = panel.scrollHeight;
  const placeTop = panelHeight > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.floor(placeTop ? spaceAbove : spaceBelow));
  evidenceStyle.value = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
    top: placeTop ? "auto" : `${rect.bottom + EVIDENCE_MARGIN}px`,
    bottom: placeTop ? `${window.innerHeight - rect.top + EVIDENCE_MARGIN}px` : "auto",
  };
}

// 팝오버 바깥 클릭(캔버스 팬 시작 포함)이나 스크롤/리사이즈로 좌표가 어긋나면 즉시 닫는다 —
// 텔레포트된 뒤라 pan/zoom을 따라가지 않으므로, 다시 열 때 새로 계산하는 편이 어긋난 위치를
// 붙잡고 있는 것보다 낫다.
function onOutsidePointerDown(event) {
  if (evidencePanelRef.value?.contains(event.target) || evidenceBtnRef.value?.contains(event.target)) return;
  closeEvidence();
}

// 팝오버 안(근거·출처 목록이 길면 overflow-y:auto로 스크롤된다)에서 마우스 휠로 스크롤해도
// 캡처 단계 scroll 리스너가 window까지 그 이벤트를 받는다 — target이 팝오버 내부면 "바깥에서
// 스크롤돼 좌표가 어긋난" 상황이 아니므로 무시해야, 팝오버 안 스크롤이 곧바로 닫히는 걸 막는다.
function onScrollMaybeCloseEvidence(event) {
  if (evidencePanelRef.value?.contains(event.target)) return;
  closeEvidence();
}

function closeEvidence() {
  if (!evidenceOpen.value) return;
  evidenceOpen.value = false;
  window.removeEventListener("pointerdown", onOutsidePointerDown, true);
  window.removeEventListener("scroll", onScrollMaybeCloseEvidence, true);
  window.removeEventListener("resize", closeEvidence);
}

async function toggleEvidence() {
  if (evidenceOpen.value) {
    closeEvidence();
    return;
  }
  closeDeleteConfirm();
  closePicker();
  evidenceOpen.value = true;
  await nextTick();
  positionEvidence();
  window.addEventListener("pointerdown", onOutsidePointerDown, true);
  window.addEventListener("scroll", onScrollMaybeCloseEvidence, true);
  window.addEventListener("resize", closeEvidence);
}

// 삭제 확인 팝오버 — 근거 팝오버와 동일한 이유(스태킹 컨텍스트·overflow:hidden 클리핑)로 body에
// 텔레포트한다. 실수로 액션을 통째로 지우는 걸 막기 위해 버튼 한 번으로 바로 지우지 않고,
// "정말 삭제하시겠습니까?" 확인을 한 번 더 거친다.
const deleteBtnRef = ref(null);
const deleteConfirmPanelRef = ref(null);
const deleteConfirmStyle = ref({});
const deleteConfirmOpen = ref(false);
const DELETE_CONFIRM_MARGIN = 8;

function positionDeleteConfirm() {
  const anchor = boxRef.value;
  const panel = deleteConfirmPanelRef.value;
  if (!anchor || !panel) return;
  const rect = anchor.getBoundingClientRect();
  const container = anchor.closest(".flow-canvas");
  const containerRect = container ? container.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const spaceBelow = containerRect.bottom - rect.bottom - DELETE_CONFIRM_MARGIN;
  const spaceAbove = rect.top - containerRect.top - DELETE_CONFIRM_MARGIN;
  const placeTop = panel.offsetHeight > spaceBelow && spaceAbove > spaceBelow;
  deleteConfirmStyle.value = {
    left: `${rect.left}px`,
    top: placeTop ? "auto" : `${rect.bottom + DELETE_CONFIRM_MARGIN}px`,
    bottom: placeTop ? `${window.innerHeight - rect.top + DELETE_CONFIRM_MARGIN}px` : "auto",
  };
}

function onOutsideDeleteConfirmPointerDown(event) {
  if (deleteConfirmPanelRef.value?.contains(event.target) || deleteBtnRef.value?.contains(event.target)) return;
  closeDeleteConfirm();
}

// 팝오버 자체 스크롤과 바깥 스크롤을 구분하는 이유는 onScrollMaybeCloseEvidence 참고.
function onScrollMaybeCloseDeleteConfirm(event) {
  if (deleteConfirmPanelRef.value?.contains(event.target)) return;
  closeDeleteConfirm();
}

function closeDeleteConfirm() {
  if (!deleteConfirmOpen.value) return;
  deleteConfirmOpen.value = false;
  window.removeEventListener("pointerdown", onOutsideDeleteConfirmPointerDown, true);
  window.removeEventListener("scroll", onScrollMaybeCloseDeleteConfirm, true);
  window.removeEventListener("resize", closeDeleteConfirm);
}

async function toggleDeleteConfirm() {
  if (deleteConfirmOpen.value) {
    closeDeleteConfirm();
    return;
  }
  closeEvidence();
  closePicker();
  deleteConfirmOpen.value = true;
  await nextTick();
  positionDeleteConfirm();
  window.addEventListener("pointerdown", onOutsideDeleteConfirmPointerDown, true);
  window.addEventListener("scroll", onScrollMaybeCloseDeleteConfirm, true);
  window.addEventListener("resize", closeDeleteConfirm);
}

function confirmDelete() {
  closeDeleteConfirm();
  emit("delete");
}

// 액션 교체 팝오버 — "다른 패키지/액션으로 바꾸기". 자유 텍스트 편집을 대체한다: 라벨을 직접
// 고치는 대신 항상 ActionCatalogList(사이드바 피커와 같은 컴포넌트)에서 골라 패키지·액션·라벨을
// 통째로 바꿔치기한다. 위치 계산은 삭제 확인 팝오버와 동일한 패턴이지만 목록이 있어 더 넓다.
const pickerBtnRef = ref(null);
const pickerPanelRef = ref(null);
const pickerStyle = ref({});
const pickerOpen = ref(false);
const PICKER_MARGIN = 8;

function positionPicker() {
  const anchor = boxRef.value;
  const panel = pickerPanelRef.value;
  if (!anchor || !panel) return;
  const rect = anchor.getBoundingClientRect();
  const container = anchor.closest(".flow-canvas");
  const containerRect = container ? container.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const spaceBelow = containerRect.bottom - rect.bottom - PICKER_MARGIN;
  const spaceAbove = rect.top - containerRect.top - PICKER_MARGIN;
  const placeTop = panel.offsetHeight > spaceBelow && spaceAbove > spaceBelow;
  pickerStyle.value = {
    left: `${rect.left}px`,
    top: placeTop ? "auto" : `${rect.bottom + PICKER_MARGIN}px`,
    bottom: placeTop ? `${window.innerHeight - rect.top + PICKER_MARGIN}px` : "auto",
  };
}

function onOutsidePickerPointerDown(event) {
  if (pickerPanelRef.value?.contains(event.target) || pickerBtnRef.value?.contains(event.target)) return;
  closePicker();
}

// 팝오버 자체 스크롤과 바깥 스크롤을 구분하는 이유는 onScrollMaybeCloseEvidence 참고 — 이 팝오버는
// 특히 ActionCatalogList의 목록이 overflow-y:auto라 마우스 휠로 스크롤할 일이 훨씬 잦다(그
// 가드 없이는 목록을 내리려는 순간 팝오버가 곧바로 닫혀 버린다).
function onScrollMaybeClosePicker(event) {
  if (pickerPanelRef.value?.contains(event.target)) return;
  closePicker();
}

function closePicker() {
  if (!pickerOpen.value) return;
  pickerOpen.value = false;
  window.removeEventListener("pointerdown", onOutsidePickerPointerDown, true);
  window.removeEventListener("scroll", onScrollMaybeClosePicker, true);
  window.removeEventListener("resize", closePicker);
}

async function togglePicker() {
  if (!props.editable) return;
  if (pickerOpen.value) {
    closePicker();
    return;
  }
  closeEvidence();
  closeDeleteConfirm();
  pickerOpen.value = true;
  await nextTick();
  positionPicker();
  window.addEventListener("pointerdown", onOutsidePickerPointerDown, true);
  window.addEventListener("scroll", onScrollMaybeClosePicker, true);
  window.addEventListener("resize", closePicker);
}

function onPickerSelect(descriptor) {
  closePicker();
  emit("change-action", descriptor);
}

onBeforeUnmount(() => {
  closeEvidence();
  closeDeleteConfirm();
  closePicker();
});
</script>

<template>
  <div ref="boxRef" class="flow-box flow-canvas-box" :class="{ 'flow-box--container': isContainer }">
    <span class="flow-canvas-box__row" :title="label" @dblclick.stop="togglePicker">
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
      ref="evidenceBtnRef"
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
      ref="pickerBtnRef"
      type="button"
      class="flow-canvas-box__edit-btn nodrag nopan"
      :class="{ 'flow-canvas-box__edit-btn--open': pickerOpen }"
      :title="t('recommendFlow.changeActionTitle')"
      :aria-label="t('recommendFlow.changeActionTitle')"
      :aria-expanded="pickerOpen"
      @pointerdown.stop
      @click.stop="togglePicker"
    >
      ✎
    </button>
    <button
      v-if="editable"
      ref="deleteBtnRef"
      type="button"
      class="flow-canvas-box__delete-btn nodrag nopan"
      :class="{ 'flow-canvas-box__delete-btn--open': deleteConfirmOpen }"
      :title="t('recommendFlow.deleteActionTitle')"
      :aria-label="t('recommendFlow.deleteActionTitle')"
      :aria-expanded="deleteConfirmOpen"
      @pointerdown.stop
      @click.stop="toggleDeleteConfirm"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5.5 7.5h13M9.5 7.5V5.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7M7.5 7.5l.8 11a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-11"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M10.3 11v5M13.7 11v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="hasEvidence && evidenceOpen"
        ref="evidencePanelRef"
        class="flow-box__evidence nodrag nopan"
        :style="evidenceStyle"
        @pointerdown.stop
      >
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
    </Teleport>
    <Teleport to="body">
      <div
        v-if="deleteConfirmOpen"
        ref="deleteConfirmPanelRef"
        class="flow-box__delete-confirm nodrag nopan"
        :style="deleteConfirmStyle"
        @pointerdown.stop
      >
        <p class="flow-box__delete-confirm-text">{{ t("recommendFlow.deleteActionConfirm") }}</p>
        <div class="flow-box__delete-confirm-actions">
          <button type="button" class="btn btn--outline btn--small" @click="closeDeleteConfirm">
            {{ t("common.cancel") }}
          </button>
          <button type="button" class="btn btn--danger btn--small" @click="confirmDelete">
            {{ t("common.delete") }}
          </button>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="pickerOpen"
        ref="pickerPanelRef"
        class="flow-box__action-picker nodrag nopan"
        :style="pickerStyle"
        @pointerdown.stop
      >
        <p class="flow-box__action-picker-title">{{ t("recommendFlow.changeActionPickerTitle") }}</p>
        <ActionCatalogList :draggable="false" @select="onPickerSelect" />
      </div>
    </Teleport>
  </div>
</template>
