<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";

const emit = defineEmits(["close"]);
const { t } = useI18n();
const auth = useAuthStore();
const settings = useSettingsStore();

// 헤더를 잡고 드래그하면 팝업을 옮길 수 있다 — ChatWidget.vue의 드래그 방식과 동일
// (position이 null인 동안은 CSS 그리드 중앙 정렬을 그대로 쓰고, 처음 드래그가 발생한
// 순간부터 position:fixed로 전환해 left/top을 직접 제어한다).
const modalRef = ref(null);
const position = reactive({ x: null, y: null });
const isDragging = ref(false);
let dragOffset = { x: 0, y: 0 };

const modalStyle = computed(() => {
  if (position.x === null) return {};
  return { left: `${position.x}px`, top: `${position.y}px` };
});

function startDrag(event) {
  if (!modalRef.value) return;
  isDragging.value = true;
  const rect = modalRef.value.getBoundingClientRect();
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", stopDrag);
  // 터치 중 OS 제스처가 가로채는 등으로 pointerup 없이 끝나면(Qodo 리뷰) isDragging이 계속
  // true로 남아 리스너가 안 풀리고, 이후 무관한 포인터 이동에도 팝업이 다시 움직인다.
  window.addEventListener("pointercancel", stopDrag);
}

function onDrag(event) {
  if (!isDragging.value || !modalRef.value) return;
  const width = modalRef.value.offsetWidth;
  const height = modalRef.value.offsetHeight;
  const maxX = window.innerWidth - width - 8;
  const maxY = window.innerHeight - height - 8;
  position.x = Math.min(Math.max(8, event.clientX - dragOffset.x), Math.max(8, maxX));
  position.y = Math.min(Math.max(8, event.clientY - dragOffset.y), Math.max(8, maxY));
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
}

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
});
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div
      ref="modalRef"
      class="modal modal--settings"
      :class="{ 'modal--floating': position.x !== null }"
      :style="modalStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header class="modal__header" @pointerdown="startDrag">
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
