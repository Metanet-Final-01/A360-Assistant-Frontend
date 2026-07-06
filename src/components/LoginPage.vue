<script setup>
import { ref } from "vue";
import { login } from "../store/workflow";
import AuthHeader from "./AuthHeader.vue";

defineEmits(["signup"]);

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const loginError = ref("");

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value;
}

function handleSubmit() {
  if (!email.value.trim() || !password.value.trim()) {
    loginError.value = "이메일과 비밀번호를 모두 입력해주세요.";
    return;
  }
  loginError.value = "";
  login();
}
</script>

<template>
  <div class="login-page">
    <AuthHeader />

    <main class="login-page__main">
      <section class="login-card" aria-labelledby="login-title">
        <h2 id="login-title" class="login-card__title">A360 ASSISTANT에 오신 것을 환영합니다</h2>
        <p class="login-card__subtitle">업무정의서 기반 작업 추천 플랫폼에 로그인하세요</p>

        <hr class="login-card__divider" />

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

          <a class="login-forgot" href="#" @click.prevent>비밀번호를 잊으셨나요?</a>

          <p v-if="loginError" class="upload-error">{{ loginError }}</p>

          <button type="submit" class="btn btn--primary login-submit">로그인</button>
        </form>

        <div class="login-divider">
          <span class="login-divider__line"></span>
          <span class="login-divider__text">또는</span>
          <span class="login-divider__line"></span>
        </div>

        <button type="button" class="btn btn--outline login-submit" @click="$emit('signup')">
          회원가입
        </button>
      </section>
    </main>
  </div>
</template>
