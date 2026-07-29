<script setup>
import { useI18n } from "vue-i18n";

// AppSidebar.vue의 세션 목록 렌더링을 공유하는 하위 컴포넌트 — 펼쳐진 사이드바의 이력
// 아코디언, 접힌 사이드바의 이력 플라이아웃, 검색 팝업(사진 3·4) 세 곳에서 동일한 항목
// 마크업을 재사용한다. 삭제(⋮) 메뉴 자체는 AppSidebar.vue가 body로 텔레포트해 전역으로
// 하나만 띄우므로, 여기서는 열기 요청만 toggle-menu로 위로 올려보낸다.
defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: null },
  activeSessionLoading: { type: Boolean, default: false },
  listStatus: { type: String, default: "idle" },
  listError: { type: String, default: "" },
  deleteError: { type: String, default: "" },
  hasMore: { type: Boolean, default: false },
});

const emit = defineEmits(["select", "toggle-menu", "show-more"]);
const { t } = useI18n();
</script>

<template>
  <p v-if="deleteError" class="upload-error">{{ deleteError }}</p>

  <ul class="archive-chat__list">
    <li v-if="listStatus === 'loading'" class="archive-chat__empty">{{ t("sidebar.loadingSessions") }}</li>
    <li v-else-if="listStatus === 'error'" class="archive-chat__empty">{{ listError }}</li>

    <template v-else>
      <li
        v-for="session in sessions"
        :key="session.id"
        class="archive-chat__item"
        :class="{ 'archive-chat__item--active': session.id === activeSessionId }"
      >
        <button type="button" class="archive-results__item-main" @click="emit('select', session.id)">
          <span
            v-if="session.id === activeSessionId && activeSessionLoading"
            class="archive-chat__item-spinner"
            role="status"
            :aria-label="t('sidebar.sessionLoading')"
          ></span>
          <span v-else class="archive-results__item-icon archive-results__item-icon--session">
            {{ (session.solution || "A360").toUpperCase() }}
          </span>
          <div class="archive-results__item-body">
            <span class="archive-results__item-title">{{ session.title || t("sidebar.untitledSession") }}</span>
            <span class="archive-results__item-date">{{ session.dateLabel }}</span>
          </div>
        </button>

        <div class="archive-chat__item-menu-wrap">
          <button
            type="button"
            class="archive-chat__item-menu-btn"
            :aria-label="t('sidebar.sessionOptions')"
            @click="emit('toggle-menu', session.id, $event)"
          >
            &#8942;
          </button>
        </div>
      </li>

      <li v-if="!sessions.length" class="archive-chat__empty">{{ t("sidebar.noSessions") }}</li>

      <li v-if="hasMore" class="archive-chat__show-more">
        <button type="button" @click="emit('show-more')">{{ t("sidebar.showMore") }}</button>
      </li>
    </template>
  </ul>
</template>
