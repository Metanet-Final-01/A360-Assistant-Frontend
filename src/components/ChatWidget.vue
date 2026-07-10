<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { formatMessage } from "../utils/chatFormat";

const props = defineProps({
  messages: { type: Array, required: true },
  open: { type: Boolean, default: false },
  docked: { type: Boolean, default: true },
  dockZoneId: { type: String, required: true },
  dockedTitle: { type: String, default: "AI 챗봇 (대화형 수정)" },
  floatingTitle: { type: String, default: "AI 챗봇" },
  hint: { type: String, default: "A360 액션·패키지 사용법 등을 질문하면 답변해드립니다." },
  // 대화 압축 버튼 노출 여부 — 메인 챗 위젯만 켠다 (긴 멀티턴 이력을 요약본으로 대체)
  showCompact: { type: Boolean, default: false },
  compacting: { type: Boolean, default: false },
});
const emit = defineEmits(["toggle", "close", "dock", "undock", "send", "compact"]);

const POPUP_WIDTH = 540;
const POPUP_HEIGHT = 780;
const MARGIN = 24;

const draft = ref("");
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

function initPosition() {
  if (position.x !== null) return;
  position.x = Math.max(MARGIN, window.innerWidth - POPUP_WIDTH - MARGIN);
  position.y = Math.max(MARGIN, window.innerHeight - POPUP_HEIGHT - 110);
}

function scrollToBottom() {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

watch(
  () => props.open || props.docked,
  async (isOpen) => {
    if (!isOpen) return;
    initPosition();
    await nextTick();
    scrollToBottom();
  },
);

onMounted(async () => {
  if (!props.open && !props.docked) return;
  initPosition();
  await nextTick();
  scrollToBottom();
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
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
  setDockZoneHighlight(false);

  if (isOverDockZone.value) {
    emit("dock");
  }
  isOverDockZone.value = false;
}

watch(
  () => props.messages.map((message) => message.text).join(""),
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

async function handleSend() {
  const message = draft.value.trim();
  if (!message) return;
  draft.value = "";
  emit("send", message);
}
</script>

<template>
<div class="chat-widget">
  <button
    v-if="!docked"
    type="button"
    class="chat-fab"
    aria-label="AI 챗봇 열기"
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
        <span class="chat-popup__title">
          {{ docked ? dockedTitle : floatingTitle }}
        </span>
        <button
          v-if="docked"
          type="button"
          class="chat-popup__minimize"
          aria-label="챗봇 최소화"
          @click="emit('undock')"
        >
          &minus;
        </button>
        <button
          v-else
          type="button"
          class="chat-popup__close"
          aria-label="챗봇 닫기"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="chat-popup__messages" ref="messagesRef">
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
            응답을 생성하는 중…
          </div>
          <div v-else class="chat-message__bubble" v-html="formatMessage(message.text)"></div>
          <span class="chat-message__time">{{ message.time }}</span>
        </div>
      </div>

      <form class="chat-popup__composer" @submit.prevent="handleSend">
        <input
          v-model="draft"
          type="text"
          placeholder="메시지 입력…"
          aria-label="챗봇에게 메시지 보내기"
        />
        <button type="submit">전송</button>
      </form>
      <div class="chat-popup__footer">
        <p class="chat-popup__hint">{{ hint }}</p>
        <button
          v-if="showCompact"
          type="button"
          class="chat-popup__compact"
          title="지금까지의 대화를 요약본으로 압축합니다"
          :disabled="compacting"
          @click="emit('compact')"
        >
          {{ compacting ? "압축 중…" : "대화 압축" }}
        </button>
      </div>
    </div>
  </Teleport>
</div>
</template>
