<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { useArchiveStore } from "../stores/archive";
import SidebarSessionList from "./SidebarSessionList.vue";

// 브랜드 · 세션 이력 · 기능 소개 · 설정 · 계정(로그아웃)까지 앱의 전역 메뉴/옵션을 전부 이
// 좌측 사이드바가 담당한다 — 예전에는 별도의 상단 헤더(AppHeader.vue)가 있었지만 화면
// 재구성(RPA-326)으로 옮겨졌던 것을 다시 사이드바로 합쳤다.
const auth = useAuthStore();
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

const emit = defineEmits(["select-session", "new-chat", "logout", "tutorial", "open-settings"]);

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

// ----- 세션 이력 -----
const HISTORY_KEY = "a360.historyExpanded";
const savedHistory = localStorage.getItem(HISTORY_KEY);
const historyExpanded = ref(savedHistory !== null ? savedHistory === "1" : true);

const VISIBLE_STEP = 10;
const openMenuId = ref(null);
const menuPosition = ref({ top: null, bottom: null, right: 0 });

const menuStyle = computed(() => ({
  top: menuPosition.value.top !== null ? `${menuPosition.value.top}px` : "auto",
  bottom: menuPosition.value.bottom !== null ? `${menuPosition.value.bottom}px` : "auto",
  right: `${menuPosition.value.right}px`,
}));

// 최근 세션 목록 — 펼쳐진 사이드바의 이력 아코디언과 접힌 사이드바의 이력 플라이아웃(사진 3)
// 양쪽에서 동일하게 쓴다. 검색 팝업(사진 4)은 별도의 검색어 기반 목록을 따로 갖는다.
const mainVisibleCount = ref(VISIBLE_STEP);
const mainVisibleSessions = computed(() => archive.sessions.slice(0, mainVisibleCount.value));
const mainHasMoreSessions = computed(() => mainVisibleCount.value < archive.sessions.length);

function showMoreMainSessions() {
  mainVisibleCount.value += VISIBLE_STEP;
}

// 접힌 사이드바에서 "세션 이력" 아이콘을 누르면 사이드바 자체를 펼치는 대신, 아이콘 옆에
// 뜨는 플라이아웃으로 최근 세션 목록만 보여준다(사진 3) — 새 채팅/검색은 이제 각자 별도의
// 아이콘 버튼이라 플라이아웃 안에는 담지 않는다.
const collapsedHistoryOpen = ref(false);
const historyFlyoutPosition = ref({ top: 0, left: 0 });

const historyOpenForDisplay = computed(() =>
  collapsedForDisplay.value ? collapsedHistoryOpen.value : historyExpanded.value,
);

// 사이드바가 펼쳐지면(반응형 전환 등으로) 접힘 전용 플라이아웃은 의미가 없으므로 닫는다.
watch(collapsedForDisplay, (collapsed) => {
  if (!collapsed) collapsedHistoryOpen.value = false;
});

function toggleHistory(event) {
  if (collapsedForDisplay.value) {
    if (collapsedHistoryOpen.value) {
      collapsedHistoryOpen.value = false;
      return;
    }
    // 트리거의 원시 좌표만으로 위치를 잡으면, 뷰포트가 좁거나 낮은 화면(모바일 가로 등)에서
    // 플라이아웃(260px 폭, 최대 min(420px, 70vh) 높이)이 오른쪽·아래로 밀려나 세션 제어가
    // 화면 밖으로 나갈 수 있다(Qodo 리뷰) — 오른쪽에 공간이 없으면 왼쪽으로 뒤집고, 아래로
    // 넘치면 위로 당겨 뷰포트 안에 들어오게 한다.
    const rect = event.currentTarget.getBoundingClientRect();
    const FLYOUT_WIDTH = 260;
    const FLYOUT_MARGIN = 8;
    const flyoutMaxHeight = Math.min(420, window.innerHeight * 0.7);
    const left =
      rect.right + FLYOUT_MARGIN + FLYOUT_WIDTH > window.innerWidth
        ? Math.max(FLYOUT_MARGIN, rect.left - FLYOUT_WIDTH - FLYOUT_MARGIN)
        : rect.right + FLYOUT_MARGIN;
    const top = Math.max(FLYOUT_MARGIN, Math.min(rect.top, window.innerHeight - flyoutMaxHeight - FLYOUT_MARGIN));
    historyFlyoutPosition.value = { top, left };
    collapsedHistoryOpen.value = true;
    return;
  }
  historyExpanded.value = !historyExpanded.value;
  localStorage.setItem(HISTORY_KEY, historyExpanded.value ? "1" : "0");
}

// ----- 검색 팝업(사진 4) -----
// 사이드바 접힘 여부와 무관하게(별도 검색 아이콘 버튼으로) 열리는 전역 검색 오버레이 —
// 이력 아코디언/플라이아웃과는 별개로 자체 검색어·페이지네이션 상태를 갖는다.
const searchQuery = ref("");
const searchVisibleCount = ref(VISIBLE_STEP);
const searchPopupOpen = ref(false);

const searchFilteredSessions = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return archive.sessions;
  return archive.sessions.filter((session) => (session.title ?? "").includes(q));
});

const searchVisibleSessions = computed(() => searchFilteredSessions.value.slice(0, searchVisibleCount.value));
const searchHasMoreSessions = computed(() => searchVisibleCount.value < searchFilteredSessions.value.length);

watch(searchQuery, () => {
  searchVisibleCount.value = VISIBLE_STEP;
});

function showMoreSearchSessions() {
  searchVisibleCount.value += VISIBLE_STEP;
}

function openSearchPopup() {
  searchQuery.value = "";
  searchVisibleCount.value = VISIBLE_STEP;
  searchPopupOpen.value = true;
}

function closeSearchPopup() {
  searchPopupOpen.value = false;
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") return;
  // 세션 옵션(⋮) 메뉴가 검색 팝업·플라이아웃 안에서 열려 있을 수 있다 — body로 텔레포트된
  // 그 메뉴는 openMenuId만으로 렌더되므로, 바깥 오버레이만 닫고 openMenuId를 안 지우면 소유
  // 행이 사라진 뒤에도 메뉴가 계속 떠 있는 채로 남는다(Qodo 리뷰). 안쪽(메뉴)부터 먼저 닫는다.
  if (openMenuId.value) {
    openMenuId.value = null;
    return;
  }
  if (searchPopupOpen.value) {
    closeSearchPopup();
    return;
  }
  if (collapsedHistoryOpen.value) collapsedHistoryOpen.value = false;
}

function startNewChat() {
  closeMobileDrawer();
  emit("new-chat");
}

onMounted(() => {
  mobileMql.addEventListener("change", handleMobileChange);
  window.addEventListener("pointerdown", closeMenuOnOutsideClick);
  window.addEventListener("keydown", handleGlobalKeydown);
  archive.loadSessions();
});

onBeforeUnmount(() => {
  mobileMql.removeEventListener("change", handleMobileChange);
  window.removeEventListener("pointerdown", closeMenuOnOutsideClick);
  window.removeEventListener("keydown", handleGlobalKeydown);
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

function selectSession(id) {
  openMenuId.value = null;
  searchPopupOpen.value = false;
  collapsedHistoryOpen.value = false;
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
  // 접힌 사이드바의 이력 플라이아웃(사진 3)도 같은 방식으로 바깥 클릭 시 닫는다 — 플라이아웃
  // 자체는 body로 텔레포트되고, 여는 버튼은 .app-sidebar__nav-item--history다.
  if (
    collapsedHistoryOpen.value &&
    !event.target.closest(".app-sidebar__history-flyout") &&
    !event.target.closest(".app-sidebar__nav-item--history")
  ) {
    collapsedHistoryOpen.value = false;
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

function runTutorial() {
  closeMobileDrawer();
  emit("tutorial");
}

function runOpenSettings() {
  closeMobileDrawer();
  emit("open-settings");
}

function runLogout() {
  closeMobileDrawer();
  emit("logout");
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
        <img
          src="../assets/a360-mark.png"
          :alt="t('sidebar.logoAlt')"
          class="app-sidebar__logo"
          width="32"
          height="32"
        />
        <span class="app-sidebar__brand-title">{{ t("sidebar.brandTitle") }}</span>
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
        <button type="button" class="app-sidebar__nav-item" :title="t('sidebar.newChat')" @click="startNewChat">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.newChat") }}</span>
        </button>

        <button type="button" class="app-sidebar__nav-item" :title="t('sidebar.search')" @click="openSearchPopup">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
            <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.search") }}</span>
        </button>

        <button
          type="button"
          class="app-sidebar__nav-item app-sidebar__nav-item--history"
          :aria-expanded="historyOpenForDisplay"
          :title="t('sidebar.historyTitle')"
          @click="toggleHistory($event)"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 12a8 8 0 1 1 3.4 6.7L4 20l1.1-3.5A7.96 7.96 0 0 1 4 12Z"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.historyTitle") }}</span>
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
            <SidebarSessionList
              :sessions="mainVisibleSessions"
              :active-session-id="props.activeSessionId"
              :active-session-loading="props.activeSessionLoading"
              :list-status="archive.listStatus"
              :list-error="archive.listError"
              :delete-error="archive.deleteError"
              :has-more="mainHasMoreSessions"
              @select="selectSession"
              @toggle-menu="toggleMenu"
              @show-more="showMoreMainSessions"
            />
          </div>
        </div>

        <button
          type="button"
          class="app-sidebar__nav-item"
          :title="t('sidebar.tutorial')"
          @click="runTutorial"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7" />
            <path
              d="M9.6 9.4a2.4 2.4 0 1 1 3.4 2.8c-.7.4-1 .9-1 1.8"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
            <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.tutorial") }}</span>
        </button>

        <button
          type="button"
          class="app-sidebar__nav-item"
          :title="t('sidebar.settings')"
          @click="runOpenSettings"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" stroke="currentColor" stroke-width="1.7" />
            <path
              d="M19.4 13.5c.05-.33.08-.66.08-1s-.03-.67-.08-1l1.6-1.25a.7.7 0 0 0 .17-.9l-1.5-2.6a.7.7 0 0 0-.85-.3l-1.9.76a7.4 7.4 0 0 0-1.73-1l-.29-2.02a.7.7 0 0 0-.7-.6h-3a.7.7 0 0 0-.7.6l-.29 2.02c-.63.24-1.21.58-1.73 1l-1.9-.76a.7.7 0 0 0-.85.3l-1.5 2.6a.7.7 0 0 0 .17.9l1.6 1.25c-.05.33-.08.66-.08 1s.03.67.08 1l-1.6 1.25a.7.7 0 0 0-.17.9l1.5 2.6c.18.3.54.42.85.3l1.9-.76c.52.42 1.1.76 1.73 1l.29 2.02c.05.34.35.6.7.6h3c.35 0 .65-.26.7-.6l.29-2.02c.63-.24 1.21-.58 1.73-1l1.9.76c.31.12.67 0 .85-.3l1.5-2.6a.7.7 0 0 0-.17-.9l-1.6-1.25Z"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
          <span class="app-sidebar__nav-label">{{ t("sidebar.settings") }}</span>
        </button>
      </nav>

      <div class="app-sidebar__footer">
        <div class="app-sidebar__profile">
          <span class="app-sidebar__avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M4.5 20c1.4-3.4 4.4-5.2 7.5-5.2s6.1 1.8 7.5 5.2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <div class="app-sidebar__profile-info">
            <span class="app-sidebar__profile-name">{{ t("sidebar.loginAccount") }}</span>
            <span class="app-sidebar__profile-email" :title="auth.userEmail || ''">
              {{ auth.userEmail || "-" }}
            </span>
          </div>
          <button
            type="button"
            class="app-sidebar__logout"
            :title="t('sidebar.logout')"
            :aria-label="t('sidebar.logout')"
            @click="runLogout"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-7A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h7a1.5 1.5 0 0 0 1.5-1.5V17"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
              <path
                d="M9.5 12H20m0 0-3-3m3 3-3 3"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
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

  <!-- 접힌 사이드바에서 "세션 이력" 아이콘을 눌렀을 때 뜨는 플라이아웃(사진 3) — 사이드바
       자체를 펼치지 않고 최근 세션 목록만 아이콘 옆에 띄운다. -->
  <Teleport to="body">
    <Transition name="fade-up">
      <div
        v-if="collapsedHistoryOpen"
        class="app-sidebar__history-flyout"
        :style="{ top: `${historyFlyoutPosition.top}px`, left: `${historyFlyoutPosition.left}px` }"
      >
        <SidebarSessionList
          :sessions="mainVisibleSessions"
          :active-session-id="props.activeSessionId"
          :active-session-loading="props.activeSessionLoading"
          :list-status="archive.listStatus"
          :list-error="archive.listError"
          :delete-error="archive.deleteError"
          :has-more="mainHasMoreSessions"
          @select="selectSession"
          @toggle-menu="toggleMenu"
          @show-more="showMoreMainSessions"
        />
      </div>
    </Transition>
  </Teleport>

  <!-- 검색 팝업(사진 4) — 사이드바 접힘 여부와 무관하게 검색 아이콘 버튼으로 연다. -->
  <Teleport to="body">
    <Transition name="fade-up">
      <div v-if="searchPopupOpen" class="app-sidebar__search-backdrop" @click="closeSearchPopup"></div>
    </Transition>
    <Transition name="fade-up">
      <div v-if="searchPopupOpen" class="app-sidebar__search-popup" role="dialog" :aria-label="t('sidebar.search')">
        <div class="app-sidebar__search-popup-header">
          <div class="archive-chat__search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
              <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('sidebar.searchPlaceholder')"
              :aria-label="t('sidebar.searchPlaceholder')"
              autofocus
            />
          </div>
          <button
            type="button"
            class="app-sidebar__search-popup-close"
            :aria-label="t('common.close')"
            :title="t('common.close')"
            @click="closeSearchPopup"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <p class="app-sidebar__search-popup-label">{{ t("sidebar.recentChats") }}</p>

        <SidebarSessionList
          :sessions="searchVisibleSessions"
          :active-session-id="props.activeSessionId"
          :active-session-loading="props.activeSessionLoading"
          :list-status="archive.listStatus"
          :list-error="archive.listError"
          :delete-error="archive.deleteError"
          :has-more="searchHasMoreSessions"
          @select="selectSession"
          @toggle-menu="toggleMenu"
          @show-more="showMoreSearchSessions"
        />
      </div>
    </Transition>
  </Teleport>
</template>
