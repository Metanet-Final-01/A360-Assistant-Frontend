<script setup>
import { onMounted, onUnmounted, ref } from "vue";

const emit = defineEmits(["logout"]);

const isMenuOpen = ref(false);
const profileRef = ref(null);

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value;
}

function handleLogout() {
  isMenuOpen.value = false;
  emit("logout");
}

function handleClickOutside(event) {
  if (profileRef.value && !profileRef.value.contains(event.target)) {
    isMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", handleClickOutside));
onUnmounted(() => document.removeEventListener("click", handleClickOutside));
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <img src="../assets/a360-mark.svg" alt="A360 로고" class="app-header__logo" />
      <div class="app-header__titles">
        <span class="app-header__eyebrow">A360 ASSISTANT</span>
        <h1 class="app-header__title">업무정의서 기반 작업 추천 플랫폼</h1>
      </div>
    </div>

    <nav class="app-header__nav" aria-label="주요 메뉴">
      <a href="#analysis" class="app-header__nav-item app-header__nav-item--active">분석</a>
      <!-- 추후 다른 메뉴 항목이 이곳에 추가될 예정 -->
    </nav>

    <div class="app-header__profile-wrap" ref="profileRef">
      <button
        type="button"
        class="app-header__profile"
        title="프로필 메뉴"
        aria-haspopup="true"
        :aria-expanded="isMenuOpen"
        aria-label="프로필 메뉴 열기"
        @click="toggleMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6" />
          <path
            d="M4.5 20c1.4-3.4 4.4-5.2 7.5-5.2s6.1 1.8 7.5 5.2"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <Transition name="fade-up">
        <div v-if="isMenuOpen" class="app-header__menu" role="menu">
          <button type="button" class="app-header__menu-item" role="menuitem" @click="handleLogout">
            로그아웃
          </button>
        </div>
      </Transition>
    </div>
  </header>
</template>
