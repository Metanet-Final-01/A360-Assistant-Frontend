<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useArchiveStore } from "../stores/archive";

// 브랜드 · 기능 소개 · 설정 · 계정(로그아웃)은 상단 헤더(AppHeader.vue)가 맡는다 —
// 이 사이드바는 세션 이력(새 채팅 · 검색 · 목록)만 담당하는 레일이다.
const archive = useArchiveStore();
const { t } = useI18n();

const props = defineProps({
  activeSessionId: { type: String, default: null },
  // activeSessionId의 분석·흐름도·채팅 이력을 불러오는 중인지 — 참이면 해당 항목에
  // 로딩 스피너를 보여준다. 로딩 도중 다른 항목을 클릭하면 activeSessionId 자체가
  // 바로 그 항목으로 옮겨가므로(pipeline.loadSession이 동기적으로 먼저 반영) 스피너도
  // 자연히 새로 클릭한 항목으로 따라 움직인다 — 별도의 취소 처리가 필요 없다.
  activeSessionLoading: { type: Boolean, default: false },
  // 활성 세션에 업로드·분석·비전 보강·추천 생성·챗 응답 대기 등 진행 중인 작업이 있는지 —
  // 그 세션을 삭제하는 도중이라도 화면을 강제로 새 채팅으로 되돌리지 않기 위한 가드(RPA-264).
  activeSessionBusy: { type: Boolean, default: false },
});

const emit = defineEmits(["select-session", "new-chat"]);

const COLLAPSE_KEY = "a360.sidebarCollapsed";
const savedCollapsed = localStorage.getItem(COLLAPSE_KEY);
const isCollapsed = ref(savedCollapsed !== null ? savedCollapsed === "1" : window.innerWidth < 1280);

// 모바일(본문 그리드가 1열로 접히는 900px 이하)에서는 사이드바를 본문 레이아웃 폭에
// 반영하지 않고 오버레이 드로어로만 띄운다 — isCollapsed(데스크톱 선호도)와는 별개로
// mobileOpen이 드로어 표시 여부를 담당하며 리사이즈에 실시간으로 반응한다.
const MOBILE_QUERY = "(max-width: 900px)";
const mobileMql = window.matchMedia(MOBILE_QUERY);
const isMobile = ref(mobileMql.matches);
const mobileOpen = ref(false);

function handleMobileChange(event) {
  isMobile.value = event.matches;
  if (event.matches) mobileOpen.value = false;
}

// 표시상 접힘 여부 — 모바일에서는 드로어 열림 상태, 데스크톱에서는 저장된 선호도를 따른다.
const collapsedForDisplay = computed(() => (isMobile.value ? !mobileOpen.value : isCollapsed.value));

const HISTORY_KEY = "a360.historyExpanded";
const savedHistory = localStorage.getItem(HISTORY_KEY);
const historyExpanded = ref(savedHistory !== null ? savedHistory === "1" : true);

const VISIBLE_STEP = 10;
const searchQuery = ref("");
const visibleCount = ref(VISIBLE_STEP);
const openMenuId = ref(null);
const menuPosition = ref({ top: null, bottom: null, right: 0 });

const menuStyle = computed(() => ({
  top: menuPosition.value.top !== null ? `${menuPosition.value.top}px` : "auto",
  bottom: menuPosition.value.bottom !== null ? `${menuPosition.value.bottom}px` : "auto",
  right: `${menuPosition.value.right}px`,
}));

function toggleCollapsed() {
  if (isMobile.value) {
    mobileOpen.value = !mobileOpen.value;
    return;
  }
  isCollapsed.value = !isCollapsed.value;
  localStorage.setItem(COLLAPSE_KEY, isCollapsed.value ? "1" : "0");
}

function closeMobileDrawer() {
  if (isMobile.value) mobileOpen.value = false;
}

function startNewChat() {
  closeMobileDrawer();
  emit("new-chat");
}

// "분석" 항목 클릭 — 사이드바가 접혀 있으면(아이콘 전용) 먼저 펼치고 이력도 함께 연다.
// 이미 펼쳐진 상태라면 이력 서브메뉴만 접었다 편다.
function toggleHistory() {
  if (collapsedForDisplay.value) {
    if (isMobile.value) {
      mobileOpen.value = true;
    } else {
      isCollapsed.value = false;
      localStorage.setItem(COLLAPSE_KEY, "0");
    }
    historyExpanded.value = true;
    localStorage.setItem(HISTORY_KEY, "1");
    return;
  }
  historyExpanded.value = !historyExpanded.value;
  localStorage.setItem(HISTORY_KEY, historyExpanded.value ? "1" : "0");
}

onMounted(() => {
  mobileMql.addEventListener("change", handleMobileChange);
  window.addEventListener("pointerdown", closeMenuOnOutsideClick);
  archive.loadSessions();
});

onBeforeUnmount(() => {
  mobileMql.removeEventListener("change", handleMobileChange);
  window.removeEventListener("pointerdown", closeMenuOnOutsideClick);
  // 메뉴가 열린 채로 언마운트되는 경우를 대비한 안전망 — 중복 remove는 안전하다.
  window.removeEventListener("scroll", closeMenuOnReflow, true);
  window.removeEventListener("resize", closeMenuOnReflow);
});

// scroll(capture) 리스너는 하위 요소의 스크롤에도 반응해 앱 전역에서 계속 발화한다(Qodo 리뷰) —
// 메뉴가 열려 있을 때만 등록해 평소(대부분의 시간)에는 비용이 들지 않게 한다.
watch(openMenuId, (id, prevId) => {
  if (id !== null && prevId === null) {
    window.addEventListener("scroll", closeMenuOnReflow, true);
    window.addEventListener("resize", closeMenuOnReflow);
  } else if (id === null && prevId !== null) {
    window.removeEventListener("scroll", closeMenuOnReflow, true);
    window.removeEventListener("resize", closeMenuOnReflow);
  }
});

const filteredSessions = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return archive.sessions;
  return archive.sessions.filter((session) => (session.title ?? "").includes(q));
});

const visibleSessions = computed(() => filteredSessions.value.slice(0, visibleCount.value));
const hasMoreSessions = computed(() => visibleCount.value < filteredSessions.value.length);

watch(searchQuery, () => {
  visibleCount.value = VISIBLE_STEP;
});

// "더 보기" — 목록 API 자체는 페이지네이션을 지원하지 않아 이미 받아온 전체 배열에서
// 10개 단위로 노출 개수를 늘리는 방식이다.
function showMoreSessions() {
  visibleCount.value += VISIBLE_STEP;
}

function selectSession(id) {
  openMenuId.value = null;
  closeMobileDrawer();
  emit("select-session", id);
}

// 메뉴는 body로 텔레포트되어 뷰포트 기준 고정 위치로 뜬다 — 사이드바 목록의
// overflow-y:auto에 의해 하단(특히 마지막 항목)에서 메뉴가 잘리던 문제를 피하기 위함.
// 버튼 아래 공간이 부족하면 위로 뒤집어 띄운다.
function toggleMenu(id, event) {
  event.stopPropagation();
  if (openMenuId.value === id) {
    openMenuId.value = null;
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const MENU_HEIGHT_ESTIMATE = 56;
  const openUp = rect.bottom + MENU_HEIGHT_ESTIMATE > window.innerHeight;
  menuPosition.value = openUp
    ? { top: null, bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
    : { top: rect.bottom + 4, bottom: null, right: window.innerWidth - rect.right };
  openMenuId.value = id;
}

// 메뉴 바깥 어디를 눌러도 닫는다 — 이력 목록 안쪽 클릭으로만 닫히던 것을 문서 전체로 넓힌다.
// 메뉴 자체는 body로 텔레포트되어 .archive-chat__item-menu-wrap 밖에 위치하므로 별도로 확인한다.
function closeMenuOnOutsideClick(event) {
  if (
    openMenuId.value &&
    !event.target.closest(".archive-chat__item-menu-wrap") &&
    !event.target.closest(".archive-chat__item-menu")
  ) {
    openMenuId.value = null;
  }
}

// 목록 스크롤/창 크기 변경 시 버튼 기준으로 계산해둔 좌표가 어긋나므로 메뉴를 닫는다.
function closeMenuOnReflow() {
  if (openMenuId.value) openMenuId.value = null;
}

async function removeSession(id, event) {
  event.stopPropagation();
  if (!window.confirm(t("sidebar.deleteConfirm"))) return;
  const wasActive = id === props.activeSessionId;
  // 활성 세션이 삭제 대상이어도, 그 세션에서 작업이 진행 중이면 화면을 새 채팅으로 넘기지
  // 않는다 — 삭제(목록 갱신)와 진행 중인 작업이 서로 방해하지 않고 병렬로 진행되게 한다.
  // 작업이 없을 때는 기존처럼 곧바로 새 채팅으로 이동해 지워진 세션 화면에 남지 않게 한다.
  const removed = await archive.removeSession(id);
  openMenuId.value = null;
  if (removed && wasActive && !props.activeSessionBusy) startNewChat();
}
</script>

<template>
  <div
    v-if="isMobile && mobileOpen"
    class="app-sidebar__backdrop"
    aria-hidden="true"
    @click="closeMobileDrawer"
  ></div>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsedForDisplay }">
    <div class="app-sidebar__inner">
      <div class="app-sidebar__top">
        <span class="app-sidebar__section-label">{{ t("sidebar.historyTitle") }}</span>
        <button
          type="button"
          class="app-sidebar__toggle"
          :title="collapsedForDisplay ? t('sidebar.expandMenu') : t('sidebar.collapseMenu')"
          :aria-label="collapsedForDisplay ? t('sidebar.expandMenu') : t('sidebar.collapseMenu')"
          :aria-expanded="!collapsedForDisplay"
          @click="toggleCollapsed"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M11.5 6 6 12l5.5 6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M18 6l-5.5 6L18 18"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <nav class="app-sidebar__nav" :aria-label="t('sidebar.mainNavLabel')" data-tour="sidebar-nav">
        <button
          type="button"
          class="app-sidebar__nav-item"
          :aria-expanded="historyExpanded && !collapsedForDisplay"
          :title="t('sidebar.analysis')"
          @click="toggleHistory"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 19.5V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v14a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5Z"
              stroke="currentColor"
              stroke-width="1.7"
            />
            <path
              d="M8 15v-3.5M12 15V8.5M16 15v-2"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.analysis") }}</span>
          <svg
            class="app-sidebar__nav-chevron"
            :class="{ 'app-sidebar__nav-chevron--open': historyExpanded }"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <div
          v-if="!collapsedForDisplay"
          class="app-sidebar__history-wrap"
          :class="{ 'app-sidebar__history-wrap--open': historyExpanded }"
        >
          <div class="app-sidebar__history">
            <button
              type="button"
              class="app-sidebar__new-chat"
              @click="startNewChat"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
              <span>{{ t("sidebar.newChat") }}</span>
            </button>

            <div class="archive-chat__search">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
                <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
              <input v-model="searchQuery" type="text" :placeholder="t('sidebar.searchPlaceholder')" :aria-label="t('sidebar.searchPlaceholder')" />
            </div>

            <p v-if="archive.deleteError" class="upload-error">{{ archive.deleteError }}</p>

            <ul class="archive-chat__list">
              <li v-if="archive.listStatus === 'loading'" class="archive-chat__empty">{{ t("sidebar.loadingSessions") }}</li>
              <li v-else-if="archive.listStatus === 'error'" class="archive-chat__empty">{{ archive.listError }}</li>

              <template v-else>
                <li
                  v-for="session in visibleSessions"
                  :key="session.id"
                  class="archive-chat__item"
                  :class="{ 'archive-chat__item--active': session.id === props.activeSessionId }"
                >
                  <button type="button" class="archive-results__item-main" @click="selectSession(session.id)">
                    <span
                      v-if="session.id === props.activeSessionId && props.activeSessionLoading"
                      class="archive-chat__item-spinner"
                      role="status"
                      :aria-label="t('sidebar.sessionLoading')"
                    ></span>
                    <span v-else class="archive-results__item-icon archive-results__item-icon--session">
                      {{ (session.solution || "A360").toUpperCase() }}
                    </span>
                    <div class="archive-results__item-body">
                      <span class="archive-results__item-title">{{ session.title || t("sidebar.untitledSession") }}</span>
                      <span class="archive-results__item-date">{{ session.dateLabel }}</span>
                    </div>
                  </button>

                  <div class="archive-chat__item-menu-wrap">
                    <button
                      type="button"
                      class="archive-chat__item-menu-btn"
                      :aria-label="t('sidebar.sessionOptions')"
                      @click="toggleMenu(session.id, $event)"
                    >
                      &#8942;
                    </button>
                  </div>
                </li>

                <li v-if="!visibleSessions.length" class="archive-chat__empty">{{ t("sidebar.noSessions") }}</li>

                <li v-if="hasMoreSessions" class="archive-chat__show-more">
                  <button type="button" @click="showMoreSessions">{{ t("sidebar.showMore") }}</button>
                </li>
              </template>
            </ul>
          </div>
        </div>

      </nav>
    </div>
  </aside>

  <Teleport to="body">
    <Transition name="fade-up">
      <div v-if="openMenuId" class="archive-chat__item-menu archive-chat__item-menu--floating" role="menu" :style="menuStyle">
        <button
          type="button"
          role="menuitem"
          class="archive-chat__item-menu-danger"
          @click="removeSession(openMenuId, $event)"
        >
          {{ t("common.delete") }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
