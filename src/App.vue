<script setup>
import { onMounted, ref, watch } from "vue";
import { useAuthStore } from "./stores/auth";
import { useChatStore } from "./stores/chat";
import { usePipelineStore } from "./stores/pipeline";
import AppSidebar from "./components/AppSidebar.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";
import TutorialOverlay from "./components/TutorialOverlay.vue";
import { ANALYSIS_PANEL_ORDER_KEY, usePanelReorder } from "./composables/usePanelReorder";

const auth = useAuthStore();
const chat = useChatStore();
const pipeline = usePipelineStore();

// 분석 화면 패널(업로드/분석 결과/도킹 챗봇) 배치 순서 — 헤더 그립 드래그로 변경.
// 이 컴포저블은 App.vue 루트에서 로그인 세션을 넘나들며 살아있으므로, 로그아웃 시
// resetToDefault()를 직접 호출해 초기화한다(아래 handleLogout).
const analysisPanels = usePanelReorder({
  storageKey: ANALYSIS_PANEL_ORDER_KEY,
  defaultOrder: ["upload", "analysis", "chat"],
  columnWidths: {
    upload: "var(--panel-col-side)",
    analysis: "minmax(0, 1fr)",
    chat: "var(--panel-col-chat)",
  },
  // 챗봇이 최소화(도킹 해제)되면 그리드 열에서 빠지고, 다시 도킹하면 저장된 자리로 복귀
  isVisible: (key) => key !== "chat" || chat.chatDocked,
});

const showSignup = ref(false);
const justRegisteredEmail = ref("");

const showTutorial = ref(false);

// 계정별로 최초 1회만 자동 표시 — 같은 브라우저에서 다른 계정으로 로그인하면 다시 뜬다.
// (userEmail은 두 로그인 경로 모두 isLoggedIn보다 먼저 세팅된다)
function tutorialKey() {
  return `a360.tutorialSeen.${auth.userEmail ?? ""}`;
}

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    // 로그아웃하면 닫는다 — 투어를 켠 채 로그아웃한 뒤 다른 계정으로 로그인해도 남지 않게.
    showTutorial.value = loggedIn && !localStorage.getItem(tutorialKey());
  },
);

function startTutorial() {
  showTutorial.value = true;
}

function closeTutorial() {
  showTutorial.value = false;
  localStorage.setItem(tutorialKey(), "1");
}

onMounted(() => {
  auth.bootstrapAuth();
});

function handleSignupComplete(email) {
  justRegisteredEmail.value = email ?? "";
  showSignup.value = false;
}

function handleLogout() {
  showSignup.value = false;
  justRegisteredEmail.value = "";
  auth.logout();
  analysisPanels.resetToDefault();
}

function handleNewChat() {
  pipeline.resetUpload();
  chat.newChat();
}
</script>

<template>
  <div v-if="auth.authChecking" class="app-loading">로그인 확인 중…</div>

  <template v-else-if="!auth.isLoggedIn">
    <LoginPage :prefill-email="justRegisteredEmail" @signup="showSignup = true" />
    <SignupPage v-if="showSignup" @login="handleSignupComplete" @close="showSignup = false" />
  </template>

  <div v-else class="app-shell">
    <AppSidebar
      :active-session-id="pipeline.sessionId"
      @select-session="pipeline.loadSession"
      @new-chat="handleNewChat"
      @logout="handleLogout"
      @tutorial="startTutorial"
    />

    <div class="app-content">
      <main class="app-main" id="analysis">
        <div
          class="app-main__grid"
          :class="{ 'app-main__grid--docked': chat.chatDocked }"
          :style="analysisPanels.gridStyle"
          v-on="analysisPanels.containerHandlers"
        >
          <UploadPanel v-bind="analysisPanels.panelProps('upload')" />
          <AnalysisPanel v-bind="analysisPanels.panelProps('analysis')" />
          <ChatWidget
            v-bind="analysisPanels.panelProps('chat')"
            panel-key="chat"
            :panel-reorder="analysisPanels"
            :messages="chat.chatMessages"
            :open="chat.chatOpen"
            :docked="chat.chatDocked"
            dock-zone-id="analysis"
            show-compact
            :compacting="chat.isCompacting"
            :usage-gauge="pipeline.usageGauge"
            @toggle="chat.toggleChat"
            @close="chat.closeChat"
            @dock="chat.dockChat"
            @undock="chat.undockChat"
            @send="chat.sendChatMessage"
            @compact="chat.compactConversation"
          />
        </div>
      </main>
    </div>

    <TutorialOverlay v-if="showTutorial" @close="closeTutorial" />
  </div>
</template>
