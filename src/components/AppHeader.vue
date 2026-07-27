<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { usePipelineStore } from "../stores/pipeline";
import { useUiStore } from "../stores/ui";
import { useRecommendationExport } from "../composables/useRecommendationExport";

const auth = useAuthStore();
const chat = useChatStore();
const pipeline = usePipelineStore();
const ui = useUiStore();
const { t } = useI18n();

const emit = defineEmits(["logout", "tutorial", "open-settings"]);

const { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx } =
  useRecommendationExport();

// 단계 내비 — 업로드 / 분석 결과 / 추천 / 챗봇 / 내보내기.
// 앞 넷은 해당 패널(또는 분석 패널의 해당 탭)로 이동하고, 마지막 하나는 드롭다운을 연다.
const NAV_ITEMS = [
  { key: "upload", labelKey: "header.nav.upload" },
  { key: "analysis", labelKey: "header.nav.analysis" },
  { key: "recommend", labelKey: "header.nav.recommend" },
  { key: "chat", labelKey: "header.nav.chat" },
];

// 활성 항목은 기본적으로 실제 상태를 따라간다: 분석 전이면 "업로드", 분석 이후에는 분석
// 패널이 지금 보여주는 탭에 맞춰 "분석 결과"/"추천". 사용자가 "챗봇"을 눌렀을 때만 수동
// 선택이 우선하며, 그마저도 파이프라인/탭이 바뀌면 자동으로 놓아 준다 — 그러지 않으면
// 한 번 누른 뒤로는 내비가 실제 화면과 어긋난 채 굳는다.
const derivedNav = computed(() => {
  if (pipeline.analysisStatus === "idle" && !pipeline.recommendation) return "upload";
  return ui.analysisTab === "flow" ? "recommend" : "analysis";
});
const manualNav = ref(null);
const activeNav = computed(() => manualNav.value ?? derivedNav.value);

function scrollToPanel(key) {
  // 챗봇은 도킹 해제 시 그리드에서 빠지고 떠 있는 팝업(또는 fab 버튼)만 남으므로 별도로 찾는다.
  const el =
    key === "chat"
      ? (document.querySelector(".chat-popup--docked") ?? document.querySelector(".chat-fab"))
      : document.querySelector(`[data-panel-key="${key}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function goTo(key) {
  if (key === "chat") {
    manualNav.value = "chat";
    // 도킹 해제된 채로 누르면 스크롤 대상이 fab뿐이라 아무 일도 안 일어난 것처럼 보인다.
    if (!chat.chatDocked && !chat.chatOpen) chat.toggleChat();
    scrollToPanel("chat");
    return;
  }
  manualNav.value = null; // 나머지는 탭/파이프라인 상태로 다시 파생되게 놓아 준다
  if (key === "upload") {
    scrollToPanel("upload");
    return;
  }
  ui.setAnalysisTab(key === "recommend" ? "flow" : "summary");
  scrollToPanel("analysis");
}

// ----- 내보내기 드롭다운 -----
const exportMenuOpen = ref(false);

async function runExport(fn) {
  exportMenuOpen.value = false;
  await fn();
}

// ----- 프로필 메뉴 (계정 · 로그아웃) -----
const profileMenuOpen = ref(false);

// window 레벨 리스너라 target이 Element라는 보장이 없다 — 아니면 그냥 바깥 클릭으로 본다.
function closeMenusOnOutsideClick(event) {
  const el = event.target instanceof Element ? event.target : null;
  if (profileMenuOpen.value && !el?.closest(".app-header__profile")) profileMenuOpen.value = false;
  if (exportMenuOpen.value && !el?.closest(".app-header__export")) exportMenuOpen.value = false;
}

function closeMenusOnEscape(event) {
  if (event.key !== "Escape") return;
  profileMenuOpen.value = false;
  exportMenuOpen.value = false;
}

onMounted(() => {
  window.addEventListener("pointerdown", closeMenusOnOutsideClick);
  window.addEventListener("keydown", closeMenusOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeMenusOnOutsideClick);
  window.removeEventListener("keydown", closeMenusOnEscape);
});

function runFromMenu(action) {
  profileMenuOpen.value = false;
  emit(action);
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <img src="../assets/a360-mark.svg" :alt="t('sidebar.logoAlt')" class="app-header__logo" />
      <div class="app-header__titles">
        <h1 class="app-header__title">{{ t("header.title") }}</h1>
        <span class="app-header__subtitle">{{ t("header.subtitle") }}</span>
      </div>
    </div>

    <nav class="app-header__nav" :aria-label="t('header.navLabel')">
      <button
        v-for="item in NAV_ITEMS"
        :key="item.key"
        type="button"
        class="app-header__nav-item"
        :class="{ 'app-header__nav-item--active': activeNav === item.key }"
        :aria-current="activeNav === item.key ? 'step' : undefined"
        :title="t(item.labelKey)"
        @click="goTo(item.key)"
      >
        <svg v-if="item.key === 'upload'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5v10m0-10 3.5 3.5M12 3.5 8.5 7M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else-if="item.key === 'analysis'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9l-5.5-5.5Z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path d="M13.5 3.5V9H19" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
          <path d="M8.5 16.5V13m3 3.5v-5.5m3 5.5v-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <svg v-else-if="item.key === 'recommend'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m12 4 2.35 4.9 5.15.72-3.75 3.72.9 5.16L12 16.06 7.35 18.5l.9-5.16L4.5 9.62l5.15-.72L12 4Z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 12.5c0 3.6-3.6 6.5-8 6.5-.9 0-1.8-.12-2.6-.35L5 20l1.1-3.1C4.8 15.75 4 14.2 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5Z"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
        </svg>
        <span class="app-header__nav-label">{{ t(item.labelKey) }}</span>
      </button>

      <div class="app-header__export">
        <button
          type="button"
          class="app-header__nav-item"
          :disabled="!canExport"
          :title="canExport ? t('header.nav.export') : t('header.exportDisabledHint')"
          :aria-expanded="exportMenuOpen"
          aria-haspopup="menu"
          @click="exportMenuOpen = !exportMenuOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 4v9.5m0 0 3.5-3.5M12 13.5 8.5 10M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="app-header__nav-label">{{ t("header.nav.export") }}</span>
        </button>
        <Transition name="fade-up">
          <div v-if="exportMenuOpen" class="app-header__menu app-header__menu--export" role="menu">
            <button type="button" role="menuitem" class="app-header__menu-item" @click="runExport(downloadJson)">
              {{ t("recommendDetail.exportJson") }}
            </button>
            <button type="button" role="menuitem" class="app-header__menu-item" @click="runExport(downloadMarkdown)">
              {{ t("recommendDetail.exportMarkdown") }}
            </button>
            <button type="button" role="menuitem" class="app-header__menu-item" @click="runExport(downloadDocx)">
              {{ t("recommendDetail.exportDocx") }}
            </button>
          </div>
        </Transition>
      </div>
    </nav>

    <div class="app-header__actions">
      <button
        type="button"
        class="app-header__icon-btn"
        :title="t('sidebar.tutorial')"
        :aria-label="t('sidebar.tutorial')"
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
      </button>

      <button
        type="button"
        class="app-header__icon-btn"
        :title="t('sidebar.settings')"
        :aria-label="t('sidebar.settings')"
        @click="emit('open-settings')"
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
      </button>

      <div class="app-header__profile">
        <button
          type="button"
          class="app-header__avatar"
          :aria-label="t('header.accountMenu')"
          :aria-expanded="profileMenuOpen"
          aria-haspopup="menu"
          @click="profileMenuOpen = !profileMenuOpen"
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
          <div v-if="profileMenuOpen" class="app-header__menu" role="menu">
            <div class="app-header__menu-account">
              <span class="app-header__menu-label">{{ t("sidebar.loginAccount") }}</span>
              <span class="app-header__menu-email" :title="auth.userEmail || ''">{{ auth.userEmail || "-" }}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              class="app-header__menu-item"
              @click="runFromMenu('open-settings')"
            >
              {{ t("sidebar.settings") }}
            </button>
            <button
              type="button"
              role="menuitem"
              class="app-header__menu-item app-header__menu-item--danger"
              @click="runFromMenu('logout')"
            >
              {{ t("sidebar.logout") }}
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <p v-if="exportError" class="app-header__export-error" role="alert">{{ exportError }}</p>
  </header>
</template>
