<script setup>
import { onMounted, ref } from "vue";
import { useAuthStore } from "./stores/auth";
import { useChatStore } from "./stores/chat";
import AppSidebar from "./components/AppSidebar.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import ArchivePage from "./components/ArchivePage.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";

const auth = useAuthStore();
const chat = useChatStore();

const showSignup = ref(false);
const justRegisteredEmail = ref("");
const activeMenu = ref("analysis");

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
    <SignupPage v-if="showSignup" @login="handleSignupComplete" />
    <LoginPage v-else :prefill-email="justRegisteredEmail" @signup="showSignup = true" />
  </template>

  <div v-else class="app-shell">
    <AppSidebar :active-menu="activeMenu" @navigate="activeMenu = $event" @logout="handleLogout" />

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
            @toggle="chat.toggleChat"
            @close="chat.closeChat"
            @dock="chat.dockChat"
            @undock="chat.undockChat"
            @send="chat.sendChatMessage"
          />
        </div>
      </main>

      <main v-else class="app-main app-main--archive" id="archive">
        <ArchivePage />
      </main>
    </div>
  </div>
</template>
