<script setup>
import { ref } from "vue";
import ArchiveChatbot from "./ArchiveChatbot.vue";
import ArchiveResults from "./ArchiveResults.vue";

const activeTab = ref("results");
</script>

<template>
  <div class="archive-page">
    <nav class="archive-tabs" aria-label="아카이브 메뉴">
      <button
        type="button"
        class="archive-tabs__item"
        :class="{ 'archive-tabs__item--active': activeTab === 'results' }"
        @click="activeTab = 'results'"
      >
        분석 결과
      </button>
      <button
        type="button"
        class="archive-tabs__item"
        :class="{ 'archive-tabs__item--active': activeTab === 'chatbot' }"
        @click="activeTab = 'chatbot'"
      >
        챗봇
      </button>
    </nav>

    <ArchiveResults v-if="activeTab === 'results'" />
    <ArchiveChatbot v-else />
  </div>
</template>
