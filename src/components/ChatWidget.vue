<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  workflow,
  toggleChat,
  closeChat,
  dockChat,
  undockChat,
  sendChatMessage,
} from "../store/workflow";

const POPUP_WIDTH = 540;
const POPUP_HEIGHT = 780;
const MARGIN = 24;
const DOCK_ZONE_ID = "analysis";

const draft = ref("");
const popupRef = ref(null);
const messagesRef = ref(null);
const position = reactive({ x: null, y: null });
const isDragging = ref(false);
const isOverDockZone = ref(false);
let dragOffset = { x: 0, y: 0 };

const popupStyle = computed(() => {
  if (workflow.chatDocked || position.x === null) return {};
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
  () => workflow.chatOpen || workflow.chatDocked,
  async (isOpen) => {
    if (!isOpen) return;
    initPosition();
    await nextTick();
    scrollToBottom();
  },
);

onMounted(async () => {
  if (!workflow.chatOpen && !workflow.chatDocked) return;
  initPosition();
  await nextTick();
  scrollToBottom();
});

function getDockZoneEl() {
  return document.getElementById(DOCK_ZONE_ID);
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
  if (!popupRef.value || workflow.chatDocked) return;
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
    dockChat();
  }
  isOverDockZone.value = false;
}

watch(
  () => workflow.chatMessages.map((message) => message.text).join(""),
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

async function handleSend() {
  const message = draft.value.trim();
  if (!message) return;
  draft.value = "";
  await sendChatMessage(message);
}
</script>

<template>
<div class="chat-widget">
  <button
    v-if="!workflow.chatDocked"
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

  <Teleport to="body" :disabled="workflow.chatDocked">
    <div
      v-if="workflow.chatOpen || workflow.chatDocked"
      ref="popupRef"
      class="chat-popup"
      :class="{ 'chat-popup--docked': workflow.chatDocked, 'chat-popup--drop-ready': isOverDockZone }"
      :style="popupStyle"
    >
      <header
        class="chat-popup__header"
        :class="{ 'chat-popup__header--static': workflow.chatDocked }"
        @pointerdown="startDrag"
      >
        <span class="chat-popup__title">
          {{ workflow.chatDocked ? "AI 챗봇 (대화형 수정)" : "AI 챗봇" }}
        </span>
        <button
          v-if="workflow.chatDocked"
          type="button"
          class="chat-popup__minimize"
          aria-label="챗봇 최소화"
          @click="undockChat"
        >
          &minus;
        </button>
        <button
          v-else
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
          <div
            class="chat-message__bubble"
            :class="{ 'chat-message__bubble--pending': message.role === 'assistant' && !message.text }"
          >
            {{ message.role === "assistant" && !message.text ? "응답을 생성하는 중…" : message.text }}
          </div>
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
      <p class="chat-popup__hint">A360 액션·패키지 사용법 등을 질문하면 답변해드립니다.</p>
    </div>
  </Teleport>
</div>
</template>
