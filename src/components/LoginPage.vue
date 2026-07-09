<script setup>
import { ref, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/http";
import AuthCard from "./AuthCard.vue";

const auth = useAuthStore();

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
    loginError.value = "이메일과 비밀번호를 모두 입력해주세요.";
    return;
  }
  loginError.value = "";
  isSubmitting.value = true;
  try {
    await auth.loginWithPassword(email.value.trim(), password.value);
  } catch (err) {
    loginError.value = err instanceof ApiError ? err.message : "로그인 중 오류가 발생했습니다.";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <AuthCard>
    <section class="login-card" aria-labelledby="login-title">
      <h2 id="login-title" class="login-card__title">로그인</h2>
      <p class="login-card__inline-link">
        계정이 없으신가요?
        <button type="button" class="login-card__link-btn" @click="$emit('signup')">회원가입</button>
      </p>

      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="login-field">
          <label class="login-field__label" for="login-email">이메일</label>
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
              placeholder="이메일 주소를 입력하세요"
              autocomplete="email"
            />
          </div>
        </div>

        <div class="login-field">
          <label class="login-field__label" for="login-password">비밀번호</label>
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
              placeholder="비밀번호를 입력하세요"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="login-input__toggle"
              :aria-label="showPassword ? '비밀번호 숨기기' : '비밀번호 표시'"
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
            {{ isSubmitting ? "로그인 중…" : "로그인" }}
          </button>
          <label class="login-remember">
            <input v-model="rememberMe" type="checkbox" />
            로그인 상태 유지
          </label>
        </div>

        <a class="login-forgot login-forgot--center" href="#" @click.prevent>비밀번호를 잊으셨나요?</a>
      </form>
    </section>
  </AuthCard>
</template>
