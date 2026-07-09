<script setup>
import AuthVisual from "./AuthVisual.vue";
</script>

<template>
  <div class="login-page">
    <AuthVisual />
    <div class="auth-card__form">
      <slot />
    </div>
  </div>
</template>
