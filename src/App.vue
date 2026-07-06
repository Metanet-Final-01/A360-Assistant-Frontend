<script setup>
import { workflow, logout, login } from "./store/workflow";
import AppHeader from "./components/AppHeader.vue";
import UploadPanel from "./components/UploadPanel.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import ChatWidget from "./components/ChatWidget.vue";
import LoginPlaceholder from "./components/LoginPlaceholder.vue";
</script>

<template>
  <LoginPlaceholder v-if="!workflow.isLoggedIn" @login="login" />

  <div v-else class="app-shell">
    <AppHeader @logout="logout" />

    <main class="app-main" id="analysis">
      <div class="app-main__grid">
        <UploadPanel />
        <AnalysisPanel />
      </div>
    </main>

    <ChatWidget />
  </div>
</template>
