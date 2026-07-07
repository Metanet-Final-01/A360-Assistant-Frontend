<script setup>
import { onMounted, ref } from "vue";
import { workflow, logout, bootstrapAuth } from "./store/workflow";
import AppHeader from "./components/AppHeader.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";

const showSignup = ref(false);
const justRegisteredEmail = ref("");

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
    <AppHeader @logout="handleLogout" />

    <main class="app-main" id="analysis">
      <div class="app-main__grid" :class="{ 'app-main__grid--docked': workflow.chatDocked }">
        <UploadPanel />
        <AnalysisPanel />
        <ChatWidget />
      </div>
    </main>
  </div>
</template>
