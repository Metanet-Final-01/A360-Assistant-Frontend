<script setup>
import { onMounted, ref } from "vue";
import {
  workflow,
  logout,
  bootstrapAuth,
  toggleChat,
  closeChat,
  dockChat,
  undockChat,
  sendChatMessage,
} from "./store/workflow";
import AppSidebar from "./components/AppSidebar.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import ArchivePage from "./components/ArchivePage.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";

const showSignup = ref(false);
const justRegisteredEmail = ref("");
const activeMenu = ref("analysis");

onMounted(() => {
  bootstrapAuth();
});

function handleSignupComplete(email) {
  justRegisteredEmail.value = email ?? "";
  showSignup.value = false;
}

function handleLogout() {
  showSignup.value = false;
  justRegisteredEmail.value = "";
  logout();
}
</script>

<template>
  <div v-if="workflow.authChecking" class="app-loading">로그인 확인 중…</div>

  <template v-else-if="!workflow.isLoggedIn">
    <SignupPage v-if="showSignup" @login="handleSignupComplete" />
    <LoginPage v-else :prefill-email="justRegisteredEmail" @signup="showSignup = true" />
  </template>

  <div v-else class="app-shell">
    <AppSidebar :active-menu="activeMenu" @navigate="activeMenu = $event" @logout="handleLogout" />

    <div class="app-content">
      <main v-if="activeMenu === 'analysis'" class="app-main" id="analysis">
        <div class="app-main__grid" :class="{ 'app-main__grid--docked': workflow.chatDocked }">
          <UploadPanel />
          <AnalysisPanel />
          <ChatWidget
            :messages="workflow.chatMessages"
            :open="workflow.chatOpen"
            :docked="workflow.chatDocked"
            dock-zone-id="analysis"
            @toggle="toggleChat"
            @close="closeChat"
            @dock="dockChat"
            @undock="undockChat"
            @send="sendChatMessage"
          />
        </div>
      </main>

      <main v-else class="app-main app-main--archive" id="archive">
        <ArchivePage />
      </main>
    </div>
  </div>
</template>
