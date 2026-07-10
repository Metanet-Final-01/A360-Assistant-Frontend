<script setup>
import { computed, ref } from "vue";
import { useArchiveStore } from "../stores/archive";
import { ARCHIVE_PANEL_ORDER_KEY, usePanelReorder } from "../composables/usePanelReorder";
import FlowModal from "./FlowModal.vue";
import ChatWidget from "./ChatWidget.vue";

const archive = useArchiveStore();

const PAGE_SIZE = 6;

const searchQuery = ref("");
const currentPage = ref(1);
const openMenuId = ref(null);
const editingId = ref(null);
const editingTitle = ref("");
const showFlowModal = ref(false);

const filteredResults = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return archive.archiveResults;
  return archive.archiveResults.filter(
    (result) => result.title.includes(q) || result.fileName.includes(q),
  );
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredResults.value.length / PAGE_SIZE)));

const pagedResults = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredResults.value.slice(start, start + PAGE_SIZE);
});

const activeResult = computed(
  () => archive.archiveResults.find((result) => result.id === archive.activeArchiveResultId) ?? null,
);

// 아카이브 화면 패널(목록/상세/도킹 챗봇) 배치 순서 — 헤더 그립 드래그로 변경
const archivePanels = usePanelReorder({
  storageKey: ARCHIVE_PANEL_ORDER_KEY,
  defaultOrder: ["list", "detail", "chat"],
  columnWidths: {
    list: "var(--panel-col-side)",
    detail: "minmax(0, 1fr)",
    chat: "var(--panel-col-chat)",
  },
  // 챗봇은 결과가 선택돼 있고 도킹된 상태에서만 그리드 열을 차지한다
  isVisible: (key) => key !== "chat" || (archive.archiveChatDocked && !!activeResult.value),
});

const steps = computed(() => activeResult.value?.analysis.steps ?? []);

function goToPage(page) {
  currentPage.value = Math.min(Math.max(1, page), pageCount.value);
}

function selectResult(id) {
  archive.selectArchiveResult(id);
  openMenuId.value = null;
}

function toggleMenu(id, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === id ? null : id;
}

function handleDocumentClick(event) {
  if (openMenuId.value && !event.target.closest(".archive-chat__item-menu-wrap")) {
    openMenuId.value = null;
  }
}

function startRename(result, event) {
  event.stopPropagation();
  editingId.value = result.id;
  editingTitle.value = result.title;
  openMenuId.value = null;
}

function commitRename() {
  if (editingId.value) {
    archive.renameArchiveResult(editingId.value, editingTitle.value);
  }
  editingId.value = null;
}

function cancelRename() {
  editingId.value = null;
}

function removeResult(id, event) {
  event.stopPropagation();
  archive.deleteArchiveResult(id);
  openMenuId.value = null;
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadResultJson() {
  if (!activeResult.value) return;
  const base = activeResult.value.fileName.replace(/\.[^.]+$/, "");
  downloadBlob(`${base}.json`, JSON.stringify(activeResult.value.analysis, null, 2), "application/json");
}
</script>

<template>
  <div
    class="app-main__grid"
    :class="{ 'app-main__grid--docked': archive.archiveChatDocked && !!activeResult }"
    :style="archivePanels.gridStyle"
    v-on="archivePanels.containerHandlers"
    @click="handleDocumentClick"
  >
    <aside class="archive-chat__sidebar" v-bind="archivePanels.panelProps('list')">
      <header class="archive-chat__sidebar-header">
        <span
          class="panel-drag-handle"
          draggable="true"
          data-panel-handle
          title="드래그하여 패널 위치 이동"
          aria-hidden="true"
          >⠿</span
        >
        분석 결과 목록
      </header>

      <div class="archive-chat__search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input v-model="searchQuery" type="text" placeholder="제목 또는 파일명 검색" aria-label="제목 또는 파일명 검색" />
      </div>

      <ul class="archive-chat__list">
        <li
          v-for="result in pagedResults"
          :key="result.id"
          class="archive-chat__item"
          :class="{ 'archive-chat__item--active': result.id === archive.activeArchiveResultId }"
        >
          <button
            v-if="editingId !== result.id"
            type="button"
            class="archive-results__item-main"
            @click="selectResult(result.id)"
          >
            <span class="archive-results__item-icon" :class="`archive-results__item-icon--${result.fileExt}`">
              {{ result.fileExt.toUpperCase() }}
            </span>
            <div class="archive-results__item-body">
              <span class="archive-results__item-title">{{ result.title }}</span>
              <span class="archive-results__item-filename">{{ result.fileName }}</span>
              <span class="archive-results__item-date">{{ result.dateLabel }}</span>
            </div>
          </button>
          <div v-else class="archive-results__item-main">
            <span class="archive-results__item-icon" :class="`archive-results__item-icon--${result.fileExt}`">
              {{ result.fileExt.toUpperCase() }}
            </span>
            <div class="archive-results__item-body">
              <input
                v-model="editingTitle"
                type="text"
                class="archive-chat__item-title-input"
                autofocus
                @keydown.enter="commitRename"
                @keydown.esc="cancelRename"
                @blur="commitRename"
              />
              <span class="archive-results__item-filename">{{ result.fileName }}</span>
              <span class="archive-results__item-date">{{ result.dateLabel }}</span>
            </div>
          </div>

          <div class="archive-chat__item-menu-wrap">
            <button
              type="button"
              class="archive-chat__item-menu-btn"
              aria-label="분석 결과 옵션"
              @click="toggleMenu(result.id, $event)"
            >
              &#8942;
            </button>
            <Transition name="fade-up">
              <div v-if="openMenuId === result.id" class="archive-chat__item-menu" role="menu">
                <button type="button" role="menuitem" @click="startRename(result, $event)">제목 수정</button>
                <button
                  type="button"
                  role="menuitem"
                  class="archive-chat__item-menu-danger"
                  @click="removeResult(result.id, $event)"
                >
                  삭제
                </button>
              </div>
            </Transition>
          </div>
        </li>

        <li v-if="!pagedResults.length" class="archive-chat__empty">분석 결과가 없습니다.</li>
      </ul>

      <nav v-if="pageCount > 1" class="archive-chat__pagination" aria-label="분석 결과 페이지">
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

    <section class="archive-chat__detail" v-bind="archivePanels.panelProps('detail')">
      <header class="archive-results__detail-header">
        <span
          class="panel-drag-handle"
          draggable="true"
          data-panel-handle
          title="드래그하여 패널 위치 이동"
          aria-hidden="true"
          >⠿</span
        >
        <h2>{{ activeResult ? activeResult.title : "분석 결과를 선택해주세요" }}</h2>
        <div v-if="activeResult" class="archive-results__header-actions">
          <button type="button" class="archive-results__header-btn" @click="downloadResultJson">JSON 저장</button>
          <button type="button" class="archive-results__header-btn" @click="showFlowModal = true">흐름도 보기</button>
        </div>
      </header>

      <div v-if="activeResult" class="archive-results__body">
        <div class="analysis-summary">
          <h3>{{ activeResult.analysis.document_title }}</h3>
          <p>{{ activeResult.analysis.summary }}</p>
        </div>

        <div class="rec-list">
          <article v-for="step in steps" :key="step.id" class="rec-card">
            <header class="rec-card__header">
              <h3>{{ step.stepNo }}. {{ step.title }}</h3>
            </header>

            <p class="rec-card__description">{{ step.action }}</p>

            <div class="rec-card__grid">
              <div class="rec-card__field">
                <span class="rec-card__field-label">입력</span>
                <span class="rec-card__field-value">{{ step.inputVar }}</span>
              </div>
              <div class="rec-card__field">
                <span class="rec-card__field-label">출력</span>
                <span class="rec-card__field-value">{{ step.outputVar }}</span>
              </div>
              <div class="rec-card__field">
                <span class="rec-card__field-label">연계 시스템</span>
                <span class="rec-card__field-value">{{ step.package }}</span>
              </div>
              <div class="rec-card__field" v-if="step.branching">
                <span class="rec-card__field-label">분기</span>
                <span class="rec-card__field-value">{{ step.branching }}</span>
              </div>
            </div>

            <footer v-if="step.evidence" class="rec-card__footer">근거: {{ step.evidence }}</footer>
          </article>
        </div>
      </div>

      <div v-else class="archive-chat__detail-empty">왼쪽 목록에서 분석 결과를 선택해주세요.</div>
    </section>

    <ChatWidget
      v-if="activeResult"
      v-bind="archivePanels.panelProps('chat')"
      panel-key="chat"
      :panel-reorder="archivePanels"
      :messages="activeResult.messages"
      :open="archive.archiveChatOpen"
      :docked="archive.archiveChatDocked"
      dock-zone-id="archive"
      docked-title="챗봇 대화 내역"
      floating-title="챗봇 대화 내역"
      hint="이 분석 결과에 대해 궁금한 점을 물어보세요."
      @toggle="archive.toggleArchiveChat"
      @close="archive.closeArchiveChat"
      @dock="archive.dockArchiveChat"
      @undock="archive.undockArchiveChat"
      @send="archive.sendArchiveChatMessage"
    />
  </div>

  <FlowModal v-if="showFlowModal" :steps="steps" @close="showFlowModal = false" />
</template>
