<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatMessage } from "../utils/chatFormat";

const { t } = useI18n();

const props = defineProps({
  messages: { type: Array, required: true },
  // 사이드바에서 세션 이력을 불러오는 중이면 참 — 도착할 때 messages가 통째로 교체되므로
  // 그 사이엔 이전 세션의 대화가 잠깐 보였다 바뀌는 대신 로딩 상태를 보여준다.
  historyLoading: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
  docked: { type: Boolean, default: true },
  dockZoneId: { type: String, required: true },
  dockedTitle: { type: String, default: "" },
  floatingTitle: { type: String, default: "" },
  // 대화 압축 버튼 노출 여부 — 메인 챗 위젯만 켠다 (긴 멀티턴 이력을 요약본으로 대체)
  showCompact: { type: Boolean, default: false },
  compacting: { type: Boolean, default: false },
  // 이전 턴의 응답을 기다리는 중이거나(챗 자체) 업로드·분석·추천 등 같은 턴 컨트롤러를 쓰는
  // 다른 작업이 진행 중이면 입력을 막는다 — 동시에 여러 턴을 보내면 응답이 뒤섞이거나
  // 진행 중이던 작업이 중간에 끊긴다.
  sending: { type: Boolean, default: false },
  // 매 턴 done.data.usage_gauge — 대화 누적 링 게이지 표시용 (RPA-83)
  // { intake_tokens, limit_tokens, ratio(0~1+), compact_recommended, compact_required }
  usageGauge: { type: Object, default: null },
  // 에이전트 버전 선택 드롭다운 (RPA-167) — 목록은 GET /api/agent/versions 원본(versions[])을
  // 그대로 받는다(하드코딩 금지). 비어 있으면(로드 실패 포함) 드롭다운 자체를 숨긴다.
  agentVersions: { type: Array, default: () => [] },
  agentVersion: { type: String, default: null },
  // 부모 그리드의 패널 재배치(usePanelReorder) 참여 키. 지정하면 도킹 상태에서만
  // 헤더에 재배치용 그립이 생긴다 — 플로팅 상태의 포인터 드래그(이동·도킹)와는 무관.
  panelKey: { type: String, default: "" },
  // panelKey와 함께 넘기면, 플로팅 상태에서 도킹 존 안의 패널 위로 드래그해 놓았을 때
  // 그 패널의 원래 자리로 들어간다(usePanelReorder가 반환하는 인스턴스를 그대로 전달).
  panelReorder: { type: Object, default: null },
});
const emit = defineEmits(["toggle", "close", "dock", "undock", "send", "compact", "select-version"]);

const POPUP_WIDTH = 540;
const POPUP_HEIGHT = 780;
const MARGIN = 24;

const draft = ref("");
const composerRef = ref(null);
const popupRef = ref(null);
const messagesRef = ref(null);
const position = reactive({ x: null, y: null });
const isDragging = ref(false);
const isOverDockZone = ref(false);
let dragOffset = { x: 0, y: 0 };

const popupStyle = computed(() => {
  if (props.docked || position.x === null) return {};
  return { left: `${position.x}px`, top: `${position.y}px` };
});

const dockedTitleDisplay = computed(() => props.dockedTitle || t("chat.dockedTitleDefault"));
const floatingTitleDisplay = computed(() => props.floatingTitle || t("chat.floatingTitleDefault"));

function initPosition() {
  if (position.x !== null) return;
  position.x = Math.max(MARGIN, window.innerWidth - POPUP_WIDTH - MARGIN);
  position.y = Math.max(MARGIN, window.innerHeight - POPUP_HEIGHT - 110);
}

// 응답 스트리밍 중 새 토큰이 올 때마다 무조건 바닥으로 스크롤하면, 사용자가 위로
// 스크롤해 이전 내용을 보려 해도 계속 아래로 끌려온다.
//
// scrollTop을 다시 읽어 "지금 바닥 근처인지" 매번 재판정하는 방식은 근본적으로 경합에서
// 자유롭지 못했다 — 타자기 효과가 16ms마다 돌아가는 동안 메인 스레드가 바쁘면(마크다운
// 파싱·v-html 재렌더 등), 휠/트랙패드 스크롤이 네이티브(컴포지터 스레드)로 이미 반영된
// 뒤에도 JS가 읽는 scrollTop 값이 그 갱신을 아직 못 따라잡은 시점에 판정이 이뤄질 수 있다.
// 그래서 "사용자가 위로 스크롤했다"는 판단을 scrollTop 위치 추론이 아니라 휠 이벤트 자체
// (deltaY<0)로 즉시, 모호함 없이 내린다 — 입력 이벤트에는 지연이 없다.
let autoScrollToBottom = true;
// 우리가 직접 scrollTop을 바닥으로 옮기면 그 결과로도 scroll 이벤트가 발생하는데, 이걸
// "사용자가 바닥까지 스크롤했다"로 착각해 재판정하지 않도록 다음 한 번의 scroll 이벤트는 무시한다.
let ignoreNextScrollEvent = false;
let previousMessages = props.messages;
let previousMessageCount = props.messages.length;

function scrollToBottom() {
  const el = messagesRef.value;
  if (!el) return;
  // 이미 바닥이면 scrollTop 대입이 no-op이라 scroll 이벤트가 뜨지 않는다 — 플래그를 세우면
  // 소비될 일 없이 남아 있다가 다음번 진짜(사용자) 스크롤 이벤트를 엉뚱하게 삼켜버린다.
  if (el.scrollTop >= el.scrollHeight - el.clientHeight) return;
  ignoreNextScrollEvent = true;
  el.scrollTop = el.scrollHeight;
}

function resumeAutoScroll() {
  autoScrollToBottom = true;
  scrollToBottom();
}

function handleMessagesWheel(event) {
  if (event.deltaY < 0) autoScrollToBottom = false;
}

let touchStartY = null;

function handleMessagesTouchStart(event) {
  touchStartY = event.touches[0]?.clientY ?? null;
}

// 터치는 wheel 이벤트가 안 뜬다 — 손가락을 아래로 끌어 콘텐츠 위쪽을 드러내는 동작(휠의
// deltaY<0과 같은 방향)에서도 자동 스크롤을 꺼야 한다. wheel과 동일하게 scrollTop을 다시 읽지
// 않고 이벤트 자체(터치 이동 방향)로 즉시 판정한다.
function handleMessagesTouchMove(event) {
  const currentY = event.touches[0]?.clientY;
  if (touchStartY === null || currentY === undefined) return;
  if (touchStartY - currentY < 0) autoScrollToBottom = false;
  touchStartY = currentY;
}

function handleMessagesScroll() {
  if (ignoreNextScrollEvent) {
    ignoreNextScrollEvent = false;
    return;
  }
  // 휠 이외의 방법(스크롤바 드래그, 터치, 키보드)으로 직접 바닥까지 돌아왔을 때 재개한다.
  const el = messagesRef.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight <= 4) {
    autoScrollToBottom = true;
  }
}

watch(
  () => props.open || props.docked,
  async (isOpen) => {
    if (!isOpen) return;
    initPosition();
    await nextTick();
    resumeAutoScroll();
  },
);

onMounted(async () => {
  if (!props.open && !props.docked) return;
  initPosition();
  await nextTick();
  resumeAutoScroll();
});

function getDockZoneEl() {
  return document.getElementById(props.dockZoneId);
}

function isPointInDockZone(event) {
  const zoneEl = getDockZoneEl();
  if (!zoneEl) return false;
  const rect = zoneEl.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function setDockZoneHighlight(active) {
  const zoneEl = getDockZoneEl();
  if (zoneEl) zoneEl.classList.toggle("app-main--drop-active", active);
}

function startDrag(event) {
  if (!popupRef.value || props.docked) return;
  isDragging.value = true;
  const rect = popupRef.value.getBoundingClientRect();
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", stopDrag);
}

// 커서 아래에 있는 패널을 찾는다. elementFromPoint는 그 순간 화면에 그려진 최상단 요소를
// 반환하는데, 드래그 중인 팝업 자신이 커서를 따라다니며 항상 커서 아래 깔려 있어 그대로 부르면
// 팝업 자신이 잡힌다 — 그래서 호출 직전에만 팝업의 pointer-events를 꺼서 그 아래 실제 패널이
// 잡히게 한다(동기 처리라 화면 깜빡임 없음).
function panelUnderCursor(event) {
  if (!popupRef.value) return null;
  popupRef.value.style.pointerEvents = "none";
  const key = props.panelReorder.panelKeyAtPoint(event.clientX, event.clientY);
  popupRef.value.style.pointerEvents = "";
  return key;
}

function onDrag(event) {
  if (!isDragging.value || !popupRef.value) return;
  const width = popupRef.value.offsetWidth;
  const height = popupRef.value.offsetHeight;
  const maxX = window.innerWidth - width - 8;
  const maxY = window.innerHeight - height - 8;
  position.x = Math.min(Math.max(8, event.clientX - dragOffset.x), Math.max(8, maxX));
  position.y = Math.min(Math.max(8, event.clientY - dragOffset.y), Math.max(8, maxY));

  isOverDockZone.value = isPointInDockZone(event);
  setDockZoneHighlight(isOverDockZone.value);

  if (props.panelReorder && props.panelKey) {
    if (isOverDockZone.value) {
      props.panelReorder.beginDrag(props.panelKey);
      props.panelReorder.setDropTarget(panelUnderCursor(event));
    } else {
      props.panelReorder.cancelDrag();
    }
  }
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
  setDockZoneHighlight(false);

  if (isOverDockZone.value) {
    // 마우스가 특정 패널 위에 있었으면(dropTargetKey) 그 자리로 들어가고,
    // 빈 공간에 놓였으면 순서를 건드리지 않고 이전 자리 그대로 도킹한다.
    props.panelReorder?.commitDrop();
    emit("dock");
  } else {
    props.panelReorder?.cancelDrag();
  }
  isOverDockZone.value = false;
}

watch(
  () => props.messages.map((message) => message.text).join(""),
  async () => {
    // 세션 전환 등으로 messages 배열 자체가 통째로 교체되면(예: 우연히 길이가 같은 다른
    // 세션 이력으로 바뀌는 경우) length 비교만으로는 스트리밍 갱신과 구분이 안 된다 —
    // 배열 참조 변경도 새 메시지/세션 전환과 동일하게 취급한다.
    const arrayReplaced = props.messages !== previousMessages;
    const countChanged = props.messages.length !== previousMessageCount;
    previousMessages = props.messages;
    previousMessageCount = props.messages.length;
    if (countChanged || arrayReplaced) {
      // 새 메시지 추가(전송, 세션 전환 등) — 사용자가 어디에 있었든 항상 바닥으로 이동한다.
      await nextTick();
      resumeAutoScroll();
    } else if (autoScrollToBottom) {
      // 같은 메시지의 스트리밍 갱신 — 사용자가 휠로 위로 올리지 않은 동안만 따라간다.
      await nextTick();
      scrollToBottom();
    }
  },
);

async function handleSend() {
  const message = draft.value.trim();
  if (!message) return;
  draft.value = "";
  emit("send", message);
  await nextTick();
  autoResizeComposer();
}

// Enter는 전송, Shift+Enter는 줄바꿈 — textarea의 기본 동작(Enter도 줄바꿈)을 덮어써야 한다.
function handleComposerKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

// 줄바꿈이 늘어난 만큼 textarea 높이를 따라가되(최대 120px, CSS와 동일), 그 이상은
// 내부 스크롤에 맡긴다.
function autoResizeComposer() {
  const el = composerRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

// ----- 대화 누적 링 게이지 (usage_gauge) -----
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 8; // viewBox 20×20, r=8

const gaugePercent = computed(() => {
  if (!props.usageGauge) return 0;
  return Math.min(100, Math.round((props.usageGauge.ratio ?? 0) * 100));
});

const gaugeDash = computed(() => (gaugePercent.value / 100) * GAUGE_CIRCUMFERENCE);

// ok(평상시) → warn(압축 권장) → critical(압축 필요) 순으로 색이 바뀐다
const gaugeLevel = computed(() => {
  const gauge = props.usageGauge;
  if (!gauge) return "ok";
  if (gauge.compact_required) return "critical";
  if (gauge.compact_recommended) return "warn";
  return "ok";
});

const gaugeTitle = computed(() => {
  const gauge = props.usageGauge;
  if (!gauge) return "";
  const used = gauge.intake_tokens?.toLocaleString?.() ?? gauge.intake_tokens;
  const limit = gauge.limit_tokens?.toLocaleString?.() ?? gauge.limit_tokens;
  const base = t("chat.gauge.base", { percent: gaugePercent.value, used, limit });
  if (gauge.compact_required) return t("chat.gauge.compactRequiredSuffix", { base });
  if (gauge.compact_recommended) return t("chat.gauge.compactRecommendedSuffix", { base });
  return base;
});

// ----- 에이전트 버전 드롭다운 (RPA-167) -----
// 패널 하단에 붙어 있어 메뉴는 위쪽으로 펼친다. label/description은 API 값 그대로 노출.
const versionMenuOpen = ref(false);

const currentVersion = computed(
  () => props.agentVersions.find((v) => v.id === props.agentVersion) ?? null,
);

function selectVersion(id) {
  versionMenuOpen.value = false;
  if (id !== props.agentVersion) emit("select-version", id);
}

// 드롭다운 바깥을 누르면 닫는다 — 다른 카드 메뉴들과 동일한 UX
function closeVersionMenuOnOutsideClick(event) {
  if (versionMenuOpen.value && !event.target.closest(".agent-version-dd")) {
    versionMenuOpen.value = false;
  }
}

// Esc로도 닫는다 — 마우스 없이 여닫는 드롭다운의 기본 기대 동작
function closeVersionMenuOnEscape(event) {
  if (versionMenuOpen.value && event.key === "Escape") {
    versionMenuOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", closeVersionMenuOnOutsideClick);
  window.addEventListener("keydown", closeVersionMenuOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeVersionMenuOnOutsideClick);
  window.removeEventListener("keydown", closeVersionMenuOnEscape);
});
</script>

<template>
<div class="chat-widget">
  <!-- 도킹 해제 상태에서도 그리드 트랙 개수를 그대로 유지하기 위한 폭 0짜리 자리표시자
       (fab 버튼은 position:fixed라 그리드에 안 잡히므로 이게 있어야 트랙 모양이 안 바뀐다) —
       그래야 도킹/해제 전환 때 grid-template-columns가 값만 부드럽게 애니메이션된다. -->
  <div v-if="!docked" class="chat-widget__ghost-slot" aria-hidden="true"></div>

  <button
    v-if="!docked"
    type="button"
    class="chat-fab"
    :aria-label="t('chat.openAria')"
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="16" height="12" rx="4" fill="#ffffff" />
      <circle cx="9" cy="13" r="1.4" fill="var(--brand-teal-dark)" />
      <circle cx="15" cy="13" r="1.4" fill="var(--brand-teal-dark)" />
      <path d="M12 3v3" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="12" cy="3" r="1.2" fill="#ffffff" />
    </svg>
  </button>

  <Teleport to="body" :disabled="docked">
    <div
      v-if="open || docked"
      ref="popupRef"
      class="chat-popup"
      :class="{ 'chat-popup--docked': docked, 'chat-popup--drop-ready': isOverDockZone }"
      :style="popupStyle"
    >
      <header
        class="chat-popup__header"
        :class="{ 'chat-popup__header--static': docked }"
        @pointerdown="startDrag"
      >
        <span
          v-if="docked && panelKey"
          class="panel-drag-handle"
          draggable="true"
          data-panel-handle
          :title="t('common.dragHandle')"
          aria-hidden="true"
          >⠿</span
        >
        <span class="chat-popup__title">
          {{ docked ? dockedTitleDisplay : floatingTitleDisplay }}
        </span>
        <button
          v-if="docked"
          type="button"
          class="chat-popup__minimize"
          :aria-label="t('chat.minimize')"
          @click="emit('undock')"
        >
          &minus;
        </button>
        <button
          v-else
          type="button"
          class="chat-popup__close"
          :aria-label="t('chat.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div
        class="chat-popup__messages"
        ref="messagesRef"
        @wheel.passive="handleMessagesWheel"
        @touchstart.passive="handleMessagesTouchStart"
        @touchmove.passive="handleMessagesTouchMove"
        @scroll="handleMessagesScroll"
      >
        <div v-if="historyLoading" class="chat-history-loading">
          <span class="analyzing-state__spinner" aria-hidden="true"></span>
          <p>{{ t("chat.historyLoading") }}</p>
        </div>

        <template v-else>
        <div
          v-for="(message, idx) in messages"
          :key="idx"
          class="chat-message"
          :class="`chat-message--${message.role}`"
        >
          <div v-if="message.role === 'assistant' && message.stages?.length" class="chat-message__stages">
            <button
              type="button"
              class="chat-message__stages-toggle"
              @click="message.stagesOpen = !message.stagesOpen"
            >
              <span
                class="chat-message__stages-chevron"
                :class="{ 'chat-message__stages-chevron--open': message.stagesOpen }"
                aria-hidden="true"
              >
                ▸
              </span>
              <span>{{ message.stages[message.stages.length - 1] }}</span>
            </button>
            <ul v-if="message.stagesOpen" class="chat-message__stages-list">
              <li v-for="(stage, stageIdx) in message.stages" :key="stageIdx">
                <span aria-hidden="true">{{
                  stageIdx === message.stages.length - 1 && message.stagesDone ? "✅" : "🔹"
                }}</span>
                {{ stage }}
              </li>
            </ul>
          </div>

          <div
            v-if="message.role === 'assistant' && !message.text"
            class="chat-message__bubble chat-message__bubble--pending"
          >
            {{ t("chat.pending") }}
          </div>
          <div v-else class="chat-message__bubble" v-html="formatMessage(message.text)"></div>

          <div v-if="message.role === 'assistant' && message.sources?.length" class="chat-message__sources">
            <button
              type="button"
              class="chat-message__sources-toggle"
              @click="message.sourcesOpen = !message.sourcesOpen"
            >
              <span
                class="chat-message__stages-chevron"
                :class="{ 'chat-message__stages-chevron--open': message.sourcesOpen }"
                aria-hidden="true"
              >
                ▸
              </span>
              {{ t("chat.sourcesCount", { count: message.sources.length }, message.sources.length) }}
            </button>
            <ul v-if="message.sourcesOpen" class="chat-message__sources-list">
              <li v-for="(source, sourceIdx) in message.sources" :key="sourceIdx">
                <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">
                  {{ source.title || source.url }}
                </a>
                <span v-else>{{ source.title || t("chat.untitledSource") }}</span>
                <span v-if="source.score != null" class="chat-message__sources-score">
                  {{ Number(source.score).toFixed(2) }}
                </span>
              </li>
            </ul>
          </div>

          <span class="chat-message__time">{{ message.time }}</span>
        </div>
        </template>
      </div>

      <form class="chat-popup__composer" @submit.prevent="handleSend">
        <textarea
          ref="composerRef"
          v-model="draft"
          rows="1"
          :placeholder="t('chat.inputPlaceholder')"
          :aria-label="t('chat.sendAria')"
          :disabled="sending"
          @keydown="handleComposerKeydown"
          @input="autoResizeComposer"
        ></textarea>
        <button type="submit" :disabled="sending">{{ t("chat.send") }}</button>
      </form>
      <div class="chat-popup__footer">
        <div v-if="agentVersions.length" class="agent-version-dd">
          <button
            type="button"
            class="agent-version-dd__btn"
            :class="{ 'agent-version-dd__btn--open': versionMenuOpen }"
            :title="currentVersion?.description || t('chat.agentVersionTitle')"
            :aria-label="t('chat.agentVersionTitle')"
            :aria-expanded="versionMenuOpen"
            aria-haspopup="listbox"
            @click="versionMenuOpen = !versionMenuOpen"
          >
            <span class="agent-version-dd__label">{{ currentVersion?.label || agentVersion || t("chat.agentVersionTitle") }}</span>
            <svg class="agent-version-dd__chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 14.5 12 10l5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <Transition name="fade-up">
            <div v-if="versionMenuOpen" class="agent-version-dd__menu" role="listbox" :aria-label="t('chat.agentVersionTitle')">
              <button
                v-for="version in agentVersions"
                :key="version.id"
                type="button"
                role="option"
                class="agent-version-dd__item"
                :class="{ 'agent-version-dd__item--active': version.id === agentVersion }"
                :aria-selected="version.id === agentVersion"
                @click="selectVersion(version.id)"
              >
                <span class="agent-version-dd__item-row">
                  <span class="agent-version-dd__item-label">{{ version.label || version.id }}</span>
                  <svg v-if="version.id === agentVersion" class="agent-version-dd__check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <span v-if="version.description" class="agent-version-dd__item-desc">{{ version.description }}</span>
              </button>
            </div>
          </Transition>
        </div>
        <button
          v-if="showCompact"
          type="button"
          class="chat-popup__compact"
          :class="{ 'chat-popup__compact--recommended': !compacting && usageGauge?.compact_recommended }"
          :title="t('chat.compactTitle')"
          :disabled="sending || compacting"
          @click="emit('compact')"
        >
          {{ compacting ? t("chat.compacting") : usageGauge?.compact_recommended ? t("chat.compactRecommended") : t("chat.compact") }}
        </button>
        <span
          v-if="usageGauge"
          class="chat-gauge"
          :class="`chat-gauge--${gaugeLevel}`"
          :title="gaugeTitle"
          role="img"
          :aria-label="gaugeTitle"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle class="chat-gauge__track" cx="10" cy="10" r="8" />
            <circle
              class="chat-gauge__fill"
              cx="10"
              cy="10"
              r="8"
              :stroke-dasharray="`${gaugeDash} ${GAUGE_CIRCUMFERENCE}`"
            />
          </svg>
          <span class="chat-gauge__label">{{ gaugePercent }}%</span>
        </span>
      </div>
    </div>
  </Teleport>
</div>
</template>
