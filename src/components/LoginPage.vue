<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/http";
import AuthCard from "./AuthCard.vue";

const auth = useAuthStore();
const { t } = useI18n();

const props = defineProps({
  prefillEmail: { type: String, default: "" },
});
defineEmits(["signup"]);

const email = ref(props.prefillEmail);
watch(
  () => props.prefillEmail,
  (value) => {
    if (value) email.value = value;
  },
);
const password = ref("");
const showPassword = ref(false);
const rememberMe = ref(false);
const loginError = ref("");
const isSubmitting = ref(false);

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value;
}

async function handleSubmit() {
  if (!email.value.trim() || !password.value.trim()) {
    loginError.value = t("auth.login.errors.missingFields");
    return;
  }
  loginError.value = "";
  isSubmitting.value = true;
  try {
    await auth.loginWithPassword(email.value.trim(), password.value);
  } catch (err) {
    loginError.value = err instanceof ApiError ? err.message : t("auth.login.errors.generic");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <AuthCard>
    <section class="login-card" aria-labelledby="login-title">
      <h2 id="login-title" class="login-card__title">{{ t("auth.login.title") }}</h2>
      <p class="login-card__inline-link">
        {{ t("auth.login.noAccount") }}
        <button type="button" class="login-card__link-btn" @click="$emit('signup')">{{ t("auth.login.signupLink") }}</button>
      </p>

      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="login-field">
          <label class="login-field__label" for="login-email">{{ t("auth.login.emailLabel") }}</label>
          <div class="login-input">
            <svg class="login-input__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M4 6.5 12 13l8-6.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <input
              id="login-email"
              v-model="email"
              type="email"
              :placeholder="t('auth.login.emailPlaceholder')"
              autocomplete="email"
            />
          </div>
        </div>

        <div class="login-field">
          <label class="login-field__label" for="login-password">{{ t("auth.login.passwordLabel") }}</label>
          <div class="login-input">
            <svg class="login-input__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M8 10.5V8a4 4 0 0 1 8 0v2.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
            <input
              id="login-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="t('auth.login.passwordPlaceholder')"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="login-input__toggle"
              :aria-label="showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')"
              @click="togglePasswordVisibility"
            >
              <svg v-if="showPassword" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
                <circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.6" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 3l18 18M10.6 5.2c.45-.07.92-.1 1.4-.1 5.4 0 9 7 9 7a15 15 0 0 1-3.1 3.9M6.6 6.6C4.2 8.2 3 11 3 11s3.6 7 9 7a8.7 8.7 0 0 0 3.3-.65M9.9 9.9a2.6 2.6 0 0 0 3.6 3.6"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <p v-if="loginError" class="upload-error">{{ loginError }}</p>

        <div class="login-actions-row">
          <button type="submit" class="btn btn--primary login-submit--compact" :disabled="isSubmitting">
            {{ isSubmitting ? t("auth.login.submitting") : t("auth.login.submit") }}
          </button>
          <label class="login-remember">
            <input v-model="rememberMe" type="checkbox" />
            {{ t("auth.login.rememberMe") }}
          </label>
        </div>
      </form>
    </section>
  </AuthCard>
</template>
