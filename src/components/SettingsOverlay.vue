<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";

const emit = defineEmits(["close"]);
const { t } = useI18n();
const auth = useAuthStore();
const settings = useSettingsStore();

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal--settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="modal__header">
        <h2 id="settings-title">{{ t("settings.title") }}</h2>
        <button type="button" class="modal__close" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </header>

      <div class="modal__body">
        <section class="settings-section">
          <h3 class="settings-section__title">{{ t("settings.account.title") }}</h3>
          <div class="settings-account">
            <span class="settings-account__avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6" />
                <path
                  d="M4.5 20c1.4-3.4 4.4-5.2 7.5-5.2s6.1 1.8 7.5 5.2"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <p class="settings-section__email">{{ auth.userEmail || "-" }}</p>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section__title">{{ t("settings.language.title") }}</h3>
          <div class="settings-segment" role="radiogroup" :aria-label="t('settings.language.title')">
            <button
              type="button"
              role="radio"
              class="settings-segment__btn"
              :class="{ 'settings-segment__btn--active': settings.locale === 'ko' }"
              :aria-checked="settings.locale === 'ko'"
              @click="settings.setLocale('ko')"
            >
              {{ t("settings.language.ko") }}
            </button>
            <button
              type="button"
              role="radio"
              class="settings-segment__btn"
              :class="{ 'settings-segment__btn--active': settings.locale === 'en' }"
              :aria-checked="settings.locale === 'en'"
              @click="settings.setLocale('en')"
            >
              {{ t("settings.language.en") }}
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section__title">{{ t("settings.theme.title") }}</h3>
          <label class="settings-switch" :aria-label="t('settings.theme.title')">
            <input
              type="checkbox"
              :checked="settings.theme === 'dark'"
              @change="settings.setTheme($event.target.checked ? 'dark' : 'light')"
            />
            <span class="settings-switch__track" aria-hidden="true"><span class="settings-switch__thumb"></span></span>
          </label>
        </section>
      </div>
    </div>
  </div>
</template>
