<script setup>
import { computed, onMounted, ref } from "vue";
import { useArchiveStore } from "../stores/archive";
import { downloadRecommendationExport } from "../api/recommend";
import { evidenceLabel } from "../utils/format";
import { ARCHIVE_PANEL_ORDER_KEY, usePanelReorder } from "../composables/usePanelReorder";
import FlowModal from "./FlowModal.vue";
import ChatWidget from "./ChatWidget.vue";

const archive = useArchiveStore();

const PAGE_SIZE = 6;

const searchQuery = ref("");
const currentPage = ref(1);
const openMenuId = ref(null);
const showFlowModal = ref(false);
const exportError = ref("");

// 아카이브 = 실제 세션 이력 — 화면에 들어올 때마다 목록을 새로 불러온다 (P0-2)
onMounted(() => {
  archive.loadSessions();
});

const filteredSessions = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return archive.sessions;
  return archive.sessions.filter((session) => (session.title ?? "").includes(q));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredSessions.value.length / PAGE_SIZE)));

const pagedSessions = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredSessions.value.slice(start, start + PAGE_SIZE);
});

const activeSession = computed(
  () => archive.sessions.find((session) => session.id === archive.activeSessionId) ?? null,
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
  // 챗봇은 세션이 선택돼 있고 도킹된 상태에서만 그리드 열을 차지한다
  isVisible: (key) => key !== "chat" || (archive.archiveChatDocked && !!activeSession.value),
});

const analysisSteps = computed(() => archive.detailAnalysis?.steps ?? []);

function goToPage(page) {
  currentPage.value = Math.min(Math.max(1, page), pageCount.value);
}

function selectSession(id) {
  archive.selectSession(id);
  exportError.value = "";
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

function removeSession(id, event) {
  event.stopPropagation();
  archive.removeSession(id);
  openMenuId.value = null;
}

// 내보내기는 백엔드 표준 export API 응답을 그대로 저장한다 (P1-3 — 골든셋 채점 포맷)
async function exportRecommendationJson() {
  const version = archive.detailRecommendation?.version;
  if (!archive.activeSessionId || !version) return;
  exportError.value = "";
  try {
    await downloadRecommendationExport(archive.activeSessionId, version);
  } catch (err) {
    exportError.value = err?.message ?? "내보내기에 실패했습니다.";
  }
}
</script>

<template>
  <div
    class="app-main__grid"
    :class="{ 'app-main__grid--docked': archive.archiveChatDocked && !!activeSession }"
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
        세션 이력
      </header>

      <div class="archive-chat__search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input v-model="searchQuery" type="text" placeholder="세션 제목 검색" aria-label="세션 제목 검색" />
      </div>

      <ul class="archive-chat__list">
        <li v-if="archive.listStatus === 'loading'" class="archive-chat__empty">세션 목록을 불러오는 중…</li>
        <li v-else-if="archive.listStatus === 'error'" class="archive-chat__empty">{{ archive.listError }}</li>

        <template v-else>
          <li
            v-for="session in pagedSessions"
            :key="session.id"
            class="archive-chat__item"
            :class="{ 'archive-chat__item--active': session.id === archive.activeSessionId }"
          >
            <button type="button" class="archive-results__item-main" @click="selectSession(session.id)">
              <span class="archive-results__item-icon archive-results__item-icon--session">
                {{ (session.solution || "A360").toUpperCase() }}
              </span>
              <div class="archive-results__item-body">
                <span class="archive-results__item-title">{{ session.title || "제목 없는 세션" }}</span>
                <span class="archive-results__item-date">{{ session.dateLabel }}</span>
              </div>
            </button>

            <div class="archive-chat__item-menu-wrap">
              <button
                type="button"
                class="archive-chat__item-menu-btn"
                aria-label="세션 옵션"
                @click="toggleMenu(session.id, $event)"
              >
                &#8942;
              </button>
              <Transition name="fade-up">
                <div v-if="openMenuId === session.id" class="archive-chat__item-menu" role="menu">
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

          <li v-if="!pagedSessions.length" class="archive-chat__empty">저장된 세션이 없습니다.</li>
        </template>
      </ul>

      <nav v-if="pageCount > 1" class="archive-chat__pagination" aria-label="세션 목록 페이지">
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
        <h2>{{ activeSession ? activeSession.title || "제목 없는 세션" : "세션을 선택해주세요" }}</h2>
        <div v-if="activeSession" class="archive-results__header-actions">
          <button
            type="button"
            class="archive-results__header-btn"
            :disabled="!archive.detailRecommendation"
            :title="archive.detailRecommendation ? '' : '저장된 흐름도가 있어야 내보낼 수 있습니다'"
            @click="exportRecommendationJson"
          >
            JSON 내보내기
          </button>
          <button
            type="button"
            class="archive-results__header-btn"
            :disabled="!archive.detailRecommendation"
            :title="archive.detailRecommendation ? '' : '이 세션에는 저장된 흐름도가 없습니다'"
            @click="showFlowModal = true"
          >
            흐름도 보기
          </button>
        </div>
      </header>

      <p v-if="exportError" class="upload-error">{{ exportError }}</p>

      <div v-if="!activeSession" class="archive-chat__detail-empty">왼쪽 목록에서 세션을 선택해주세요.</div>

      <div v-else-if="archive.detailStatus === 'loading'" class="archive-chat__detail-empty">
        세션 내용을 불러오는 중…
      </div>

      <div v-else-if="archive.detailStatus === 'error'" class="archive-chat__detail-empty">
        {{ archive.detailError }}
      </div>

      <div v-else class="archive-results__body">
        <template v-if="archive.detailAnalysis">
          <div class="analysis-summary">
            <h3>{{ archive.detailAnalysis.document_title || "분석 결과" }}</h3>
            <p>{{ archive.detailAnalysis.summary }}</p>
          </div>

          <div class="rec-list">
            <article v-for="step in analysisSteps" :key="step.step_id" class="rec-card">
              <header class="rec-card__header">
                <h3>{{ step.order }}. {{ step.name }}</h3>
              </header>

              <p class="rec-card__description">{{ step.description }}</p>

              <div class="rec-card__grid">
                <div class="rec-card__field">
                  <span class="rec-card__field-label">입력</span>
                  <span class="rec-card__field-value">{{ step.inputs?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field">
                  <span class="rec-card__field-label">출력</span>
                  <span class="rec-card__field-value">{{ step.outputs?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field">
                  <span class="rec-card__field-label">연계 시스템</span>
                  <span class="rec-card__field-value">{{ step.systems?.join(", ") || "없음" }}</span>
                </div>
                <div class="rec-card__field" v-if="step.branching">
                  <span class="rec-card__field-label">분기</span>
                  <span class="rec-card__field-value">{{ step.branching }}</span>
                </div>
              </div>

              <footer v-if="step.evidence" class="rec-card__footer">근거: {{ evidenceLabel(step.evidence) }}</footer>
            </article>
          </div>

          <div v-if="archive.detailAnalysis.ambiguities?.length" class="ambiguities-section">
            <h3 class="ambiguities-section__title">확인 필요</h3>
            <ul>
              <li v-for="(item, idx) in archive.detailAnalysis.ambiguities" :key="idx">{{ item }}</li>
            </ul>
          </div>
        </template>

        <div v-else class="archive-chat__detail-empty">
          이 세션에는 분석 결과가 없습니다. 오른쪽 챗봇으로 대화를 이어갈 수 있습니다.
        </div>
      </div>
    </section>

    <ChatWidget
      v-if="activeSession"
      v-bind="archivePanels.panelProps('chat')"
      panel-key="chat"
      :panel-reorder="archivePanels"
      :messages="archive.detailMessages"
      :open="archive.archiveChatOpen"
      :docked="archive.archiveChatDocked"
      dock-zone-id="archive"
      docked-title="챗봇 대화 내역"
      floating-title="챗봇 대화 내역"
      hint="이 세션에 대해 궁금한 점을 물어보세요."
      @toggle="archive.toggleArchiveChat"
      @close="archive.closeArchiveChat"
      @dock="archive.dockArchiveChat"
      @undock="archive.undockArchiveChat"
      @send="archive.sendArchiveChatMessage"
    />
  </div>

  <FlowModal
    v-if="showFlowModal && archive.detailRecommendation"
    :recommendation="archive.detailRecommendation.recommendation"
    :version="archive.detailRecommendation.version"
    @close="showFlowModal = false"
  />
</template>
