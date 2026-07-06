<script setup>
import { ref } from "vue";
import { workflow, logout } from "./store/workflow";
import AppHeader from "./components/AppHeader.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import LoginPage from "./components/LoginPage.vue";
import SignupPage from "./components/SignupPage.vue";

const showSignup = ref(false);
</script>

<template>
  <template v-if="!workflow.isLoggedIn">
    <SignupPage v-if="showSignup" @login="showSignup = false" />
    <LoginPage v-else @signup="showSignup = true" />
  </template>

  <div v-else class="app-shell">
    <AppHeader @logout="logout" />

    <main class="app-main" id="analysis">
      <div class="app-main__grid" :class="{ 'app-main__grid--docked': workflow.chatDocked }">
        <UploadPanel />
        <AnalysisPanel />
        <ChatWidget />
      </div>
    </main>
  </div>
</template>
