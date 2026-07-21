<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { useArchiveStore } from "../stores/archive";

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
});

const emit = defineEmits(["logout", "tutorial", "open-settings", "select-session", "new-chat"]);

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
  const removed = await archive.removeSession(id);
  openMenuId.value = null;
  if (removed && wasActive) startNewChat();
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
      <div class="app-sidebar__brand">
        <img src="../assets/a360-mark.svg" :alt="t('sidebar.logoAlt')" class="app-sidebar__logo" />
        <span class="app-sidebar__brand-title">A360 ASSISTANT</span>
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

        <button
          type="button"
          class="app-sidebar__nav-item app-sidebar__help"
          :title="t('sidebar.tutorial')"
          @click="emit('tutorial')"
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
          class="app-sidebar__nav-item app-sidebar__help"
          :title="t('sidebar.settings')"
          @click="emit('open-settings')"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
              stroke="currentColor"
              stroke-width="1.7"
            />
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
            @click="emit('logout')"
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
</template>
