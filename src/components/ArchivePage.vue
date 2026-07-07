<script setup>
import { ref } from "vue";
import ArchiveChatbot from "./ArchiveChatbot.vue";

const activeTab = ref("chatbot");
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

    <section v-if="activeTab === 'results'" class="archive-placeholder">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 6h16M4 12h10M4 18h7"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      <p>분석 결과 아카이브는 준비 중입니다.</p>
    </section>

    <ArchiveChatbot v-else />
  </div>
</template>
