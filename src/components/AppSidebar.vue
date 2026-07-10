<script setup>
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

const props = defineProps({
  activeMenu: { type: String, default: "analysis" },
});

const emit = defineEmits(["logout", "navigate", "tutorial"]);

const COLLAPSE_KEY = "a360.sidebarCollapsed";
const saved = localStorage.getItem(COLLAPSE_KEY);
const isCollapsed = ref(saved !== null ? saved === "1" : window.innerWidth < 1280);

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
  localStorage.setItem(COLLAPSE_KEY, isCollapsed.value ? "1" : "0");
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': isCollapsed }">
    <div class="app-sidebar__inner">
      <div class="app-sidebar__brand">
        <img src="../assets/a360-mark.svg" alt="A360 로고" class="app-sidebar__logo" />
        <span class="app-sidebar__brand-title">A360 ASSISTANT</span>
        <button
          type="button"
          class="app-sidebar__toggle"
          :title="isCollapsed ? '메뉴 펼치기' : '메뉴 접기'"
          :aria-label="isCollapsed ? '메뉴 펼치기' : '메뉴 접기'"
          :aria-expanded="!isCollapsed"
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

      <nav class="app-sidebar__nav" aria-label="주요 메뉴" data-tour="sidebar-nav">
        <button
          type="button"
          class="app-sidebar__nav-item"
          :class="{ 'app-sidebar__nav-item--active': props.activeMenu === 'analysis' }"
          :aria-current="props.activeMenu === 'analysis' ? 'page' : undefined"
          title="분석"
          @click="emit('navigate', 'analysis')"
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
          <span class="app-sidebar__nav-label">분석</span>
        </button>
        <button
          type="button"
          class="app-sidebar__nav-item"
          :class="{ 'app-sidebar__nav-item--active': props.activeMenu === 'archive' }"
          :aria-current="props.activeMenu === 'archive' ? 'page' : undefined"
          title="아카이브"
          @click="emit('navigate', 'archive')"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" stroke="currentColor" stroke-width="1.7" />
            <path
              d="M5.5 9v9A1.5 1.5 0 0 0 7 19.5h10a1.5 1.5 0 0 0 1.5-1.5V9"
              stroke="currentColor"
              stroke-width="1.7"
            />
            <path d="M10 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          <span class="app-sidebar__nav-label">아카이브</span>
        </button>
      </nav>

      <div class="app-sidebar__footer">
        <button
          type="button"
          class="app-sidebar__nav-item app-sidebar__help"
          title="기능 소개"
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
          <span class="app-sidebar__nav-label">기능 소개</span>
        </button>
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
            <span class="app-sidebar__profile-name">로그인 계정</span>
            <span class="app-sidebar__profile-email" :title="auth.userEmail || ''">
              {{ auth.userEmail || "-" }}
            </span>
          </div>
          <button
            type="button"
            class="app-sidebar__logout"
            title="로그아웃"
            aria-label="로그아웃"
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
</template>
