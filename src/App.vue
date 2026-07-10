<script setup>
import { onMounted, ref, watch } from "vue";
import { useAuthStore } from "./stores/auth";
import { useChatStore } from "./stores/chat";
import AppSidebar from "./components/AppSidebar.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import ArchivePage from "./components/ArchivePage.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";
import TutorialOverlay from "./components/TutorialOverlay.vue";

const auth = useAuthStore();
const chat = useChatStore();

const showSignup = ref(false);
const justRegisteredEmail = ref("");
const activeMenu = ref("analysis");

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
  activeMenu.value = "analysis"; // 튜토리얼 대상 요소들이 분석 화면에 있다
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
      :active-menu="activeMenu"
      @navigate="activeMenu = $event"
      @logout="handleLogout"
      @tutorial="startTutorial"
    />

    <div class="app-content">
      <main v-if="activeMenu === 'analysis'" class="app-main" id="analysis">
        <div class="app-main__grid" :class="{ 'app-main__grid--docked': chat.chatDocked }">
          <UploadPanel />
          <AnalysisPanel />
          <ChatWidget
            :messages="chat.chatMessages"
            :open="chat.chatOpen"
            :docked="chat.chatDocked"
            dock-zone-id="analysis"
            show-compact
            :compacting="chat.isCompacting"
            @toggle="chat.toggleChat"
            @close="chat.closeChat"
            @dock="chat.dockChat"
            @undock="chat.undockChat"
            @send="chat.sendChatMessage"
            @compact="chat.compactConversation"
          />
        </div>
      </main>

      <main v-else class="app-main app-main--archive" id="archive">
        <ArchivePage />
      </main>
    </div>

    <TutorialOverlay v-if="showTutorial" @close="closeTutorial" />
  </div>
</template>
