<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/http";

const auth = useAuthStore();
const { t } = useI18n();

const emit = defineEmits(["login", "close"]);

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const signupError = ref("");
const isSubmitting = ref(false);

function toggleShow(field) {
  if (field === "password") showPassword.value = !showPassword.value;
  else showConfirmPassword.value = !showConfirmPassword.value;
}

async function handleSubmit() {
  if (!email.value.trim() || !password.value.trim() || !confirmPassword.value.trim()) {
    signupError.value = t("auth.signup.errors.missingFields");
    return;
  }
  if (!PASSWORD_RULE.test(password.value)) {
    signupError.value = t("auth.signup.errors.passwordRule");
    return;
  }
  if (password.value !== confirmPassword.value) {
    signupError.value = t("auth.signup.errors.mismatch");
    return;
  }
  signupError.value = "";
  isSubmitting.value = true;
  try {
    const registeredEmail = email.value.trim();
    await auth.registerWithPassword(registeredEmail, password.value);
    window.alert(t("auth.signup.completeAlert"));
    emit("login", registeredEmail);
  } catch (err) {
    signupError.value = err instanceof ApiError ? err.message : t("auth.signup.errors.generic");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--signup" role="dialog" aria-modal="true" aria-labelledby="signup-title">
      <header class="modal__header">
        <h2 id="signup-title">{{ t("auth.signup.title") }}</h2>
        <button type="button" class="modal__close" :aria-label="t('common.close')" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body">
        <section class="login-card login-card--modal" aria-labelledby="signup-title">
          <p class="login-card__inline-link">
            {{ t("auth.signup.hasAccount") }}
            <button type="button" class="login-card__link-btn" @click="$emit('login')">{{ t("auth.signup.loginLink") }}</button>
          </p>

          <form class="login-form" @submit.prevent="handleSubmit">
            <div class="login-field">
              <label class="login-field__label" for="signup-email">{{ t("auth.signup.emailLabel") }}</label>
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
                  id="signup-email"
                  v-model="email"
                  type="email"
                  :placeholder="t('auth.signup.emailPlaceholder')"
                  autocomplete="email"
                />
              </div>
            </div>

            <div class="login-field">
              <label class="login-field__label" for="signup-password">{{ t("auth.signup.passwordLabel") }}</label>
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
                  id="signup-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  :placeholder="t('auth.signup.passwordPlaceholder')"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="login-input__toggle"
                  :aria-label="showPassword ? t('auth.signup.hidePassword') : t('auth.signup.showPassword')"
                  @click="toggleShow('password')"
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
              <p class="login-field__hint">{{ t("auth.signup.passwordHint") }}</p>
            </div>

            <div class="login-field">
              <label class="login-field__label" for="signup-password-confirm">{{ t("auth.signup.confirmPasswordLabel") }}</label>
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
                  id="signup-password-confirm"
                  v-model="confirmPassword"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  :placeholder="t('auth.signup.confirmPasswordPlaceholder')"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="login-input__toggle"
                  :aria-label="showConfirmPassword ? t('auth.signup.hidePassword') : t('auth.signup.showPassword')"
                  @click="toggleShow('confirm')"
                >
                  <svg v-if="showConfirmPassword" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

            <p v-if="signupError" class="upload-error">{{ signupError }}</p>

            <button type="submit" class="btn btn--primary login-submit" :disabled="isSubmitting">
              {{ isSubmitting ? t("auth.signup.submitting") : t("auth.signup.submit") }}
            </button>
          </form>
        </section>
      </div>
    </div>
  </div>
</template>
