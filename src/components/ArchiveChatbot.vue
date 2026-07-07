<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  workflow,
  selectArchiveSession,
  renameArchiveSession,
  deleteArchiveSession,
  sendArchiveChatMessage,
} from "../store/workflow";

const PAGE_SIZE = 8;

const searchQuery = ref("");
const currentPage = ref(1);
const openMenuId = ref(null);
const editingId = ref(null);
const editingTitle = ref("");
const draft = ref("");
const messagesRef = ref(null);

const filteredSessions = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return workflow.archiveSessions;
  return workflow.archiveSessions.filter((session) => session.title.includes(q));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredSessions.value.length / PAGE_SIZE)));

const pagedSessions = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredSessions.value.slice(start, start + PAGE_SIZE);
});

watch([searchQuery, pageCount], () => {
  if (currentPage.value > pageCount.value) currentPage.value = pageCount.value;
});

const activeSession = computed(
  () => workflow.archiveSessions.find((session) => session.id === workflow.activeArchiveSessionId) ?? null,
);

function previewOf(session) {
  const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
  const source = lastUser?.text ?? session.messages[0]?.text ?? "";
  return source.length > 34 ? `${source.slice(0, 34)}...` : source;
}

function scrollToBottom() {
  if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
}

watch(
  () => activeSession.value?.messages.map((message) => message.text).join("") ?? "",
  async () => {
    await nextTick();
    scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => workflow.activeArchiveSessionId,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

function selectSession(id) {
  selectArchiveSession(id);
  openMenuId.value = null;
}

function toggleMenu(id, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === id ? null : id;
}

function closeMenu() {
  openMenuId.value = null;
}

function handleDocumentClick(event) {
  if (openMenuId.value && !event.target.closest(".archive-chat__item-menu-wrap")) {
    openMenuId.value = null;
  }
}

function startRename(session, event) {
  event.stopPropagation();
  editingId.value = session.id;
  editingTitle.value = session.title;
  openMenuId.value = null;
}

function commitRename() {
  if (editingId.value) {
    renameArchiveSession(editingId.value, editingTitle.value);
  }
  editingId.value = null;
}

function cancelRename() {
  editingId.value = null;
}

function removeSession(id, event) {
  event.stopPropagation();
  deleteArchiveSession(id);
  openMenuId.value = null;
}

function goToPage(page) {
  currentPage.value = Math.min(Math.max(1, page), pageCount.value);
}

async function handleSend() {
  const message = draft.value.trim();
  if (!message || !activeSession.value) return;
  draft.value = "";
  await sendArchiveChatMessage(activeSession.value.id, message);
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function formatMessage(text) {
  const escaped = text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
</script>

<template>
  <div class="archive-chat" @click="handleDocumentClick">
    <aside class="archive-chat__sidebar">
      <header class="archive-chat__sidebar-header">채팅 기록</header>

      <div class="archive-chat__search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input v-model="searchQuery" type="text" placeholder="채팅 제목 검색" aria-label="채팅 제목 검색" />
      </div>

      <ul class="archive-chat__list">
        <li
          v-for="session in pagedSessions"
          :key="session.id"
          class="archive-chat__item"
          :class="{ 'archive-chat__item--active': session.id === workflow.activeArchiveSessionId }"
        >
          <button type="button" class="archive-chat__item-main" @click="selectSession(session.id)">
            <div class="archive-chat__item-top">
              <input
                v-if="editingId === session.id"
                v-model="editingTitle"
                type="text"
                class="archive-chat__item-title-input"
                autofocus
                @click.stop
                @keydown.enter="commitRename"
                @keydown.esc="cancelRename"
                @blur="commitRename"
              />
              <span v-else class="archive-chat__item-title">{{ session.title }}</span>
              <span class="archive-chat__item-date">{{ session.dateLabel }}</span>
            </div>
            <p class="archive-chat__item-preview">{{ previewOf(session) }}</p>
          </button>

          <div class="archive-chat__item-menu-wrap">
            <button
              type="button"
              class="archive-chat__item-menu-btn"
              aria-label="채팅 옵션"
              @click="toggleMenu(session.id, $event)"
            >
              &#8942;
            </button>
            <Transition name="fade-up">
              <div v-if="openMenuId === session.id" class="archive-chat__item-menu" role="menu">
                <button type="button" role="menuitem" @click="startRename(session, $event)">제목 수정</button>
                <button
                  type="button"
                  role="menuitem"
                  class="archive-chat__item-menu-danger"
                  @click="removeSession(session.id, $event)"
                >
                  삭제
                </button>
              </div>
            </Transition>
          </div>
        </li>

        <li v-if="!pagedSessions.length" class="archive-chat__empty">대화 기록이 없습니다.</li>
      </ul>

      <nav v-if="pageCount > 1" class="archive-chat__pagination" aria-label="채팅 기록 페이지">
        <button type="button" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">‹</button>
        <button
          v-for="page in pageCount"
          :key="page"
          type="button"
          class="archive-chat__page-btn"
          :class="{ 'archive-chat__page-btn--active': page === currentPage }"
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
        <button type="button" :disabled="currentPage === pageCount" @click="goToPage(currentPage + 1)">›</button>
      </nav>
    </aside>

    <section class="archive-chat__detail">
      <header class="archive-chat__detail-header">
        <h2>{{ activeSession ? activeSession.title : "대화를 선택해주세요" }}</h2>
      </header>

      <template v-if="activeSession">
        <div class="chat-popup__messages" ref="messagesRef">
          <div
            v-for="(message, idx) in activeSession.messages"
            :key="idx"
            class="chat-message"
            :class="`chat-message--${message.role}`"
          >
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
          <input v-model="draft" type="text" placeholder="메시지 입력…" aria-label="챗봇에게 메시지 보내기" />
          <button type="submit">전송</button>
        </form>
        <p class="chat-popup__hint">A360 액션·패키지 사용법 등을 질문하면 답변드립니다.</p>
      </template>

      <div v-else class="archive-chat__detail-empty">왼쪽 목록에서 대화를 선택해주세요.</div>
    </section>
  </div>
</template>
