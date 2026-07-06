<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { workflow, toggleChat, closeChat, sendChatMessage } from "../store/workflow";

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 520;
const MARGIN = 24;

const draft = ref("");
const popupRef = ref(null);
const messagesRef = ref(null);
const position = reactive({ x: null, y: null });
const isDragging = ref(false);
let dragOffset = { x: 0, y: 0 };

const popupStyle = computed(() => {
  if (position.x === null) return {};
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
  () => workflow.chatOpen,
  async (isOpen) => {
    if (!isOpen) return;
    initPosition();
    await nextTick();
    scrollToBottom();
  },
);

function startDrag(event) {
  if (!popupRef.value) return;
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
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
}

async function handleSend() {
  if (!draft.value.trim()) return;
  sendChatMessage(draft.value);
  draft.value = "";
  await nextTick();
  scrollToBottom();
  setTimeout(scrollToBottom, 700);
}
</script>

<template>
  <button
    type="button"
    class="chat-fab"
    aria-label="AI 챗봇 열기"
    @click="toggleChat"
  >
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="16" height="12" rx="4" fill="#ffffff" />
      <circle cx="9" cy="13" r="1.4" fill="var(--brand-teal-dark)" />
      <circle cx="15" cy="13" r="1.4" fill="var(--brand-teal-dark)" />
      <path d="M12 3v3" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="12" cy="3" r="1.2" fill="#ffffff" />
    </svg>
  </button>

  <Teleport to="body">
    <div
      v-if="workflow.chatOpen"
      ref="popupRef"
      class="chat-popup"
      :style="popupStyle"
    >
      <header class="chat-popup__header" @pointerdown="startDrag">
        <span class="chat-popup__title">AI 챗봇</span>
        <button
          type="button"
          class="chat-popup__close"
          aria-label="챗봇 닫기"
          @click="closeChat"
        >
          ✕
        </button>
      </header>

      <div class="chat-popup__messages" ref="messagesRef">
        <div
          v-for="(message, idx) in workflow.chatMessages"
          :key="idx"
          class="chat-message"
          :class="`chat-message--${message.role}`"
        >
          <div class="chat-message__bubble">{{ message.text }}</div>
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
      <p class="chat-popup__hint">분석 결과에 대한 질문을 입력하면 답변해드립니다.</p>
    </div>
  </Teleport>
</template>
