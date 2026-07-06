<script setup>
defineEmits(["login"]);
</script>

<template>
  <main class="login-placeholder">
    <section class="login-placeholder__card">
      <img src="../assets/a360-mark.svg" alt="A360 로고" class="login-placeholder__logo" />
      <h1>A360 ASSISTANT</h1>
      <p class="login-placeholder__eyebrow">업무정의서 기반 작업 추천 플랫폼</p>
      <p class="login-placeholder__desc">
        로그인 · 회원가입 화면은 아직 준비 중입니다.<br />
        데모를 계속 진행하시려면 아래 버튼을 눌러주세요.
      </p>
      <button type="button" class="btn btn--primary" @click="$emit('login')">
        임시 로그인하고 계속하기
      </button>
    </section>
  </main>
</template>
