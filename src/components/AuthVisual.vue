<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import slide1Photo from "../assets/login1.webp";
import slide2Photo from "../assets/login2.webp";
import slide3Photo from "../assets/login3.webp";

const { t } = useI18n();

const SLIDE_COUNT = 3;
const SLIDE_INTERVAL = 4200;

const current = ref(0);
const previous = ref(-1);
let timer = null;

function goTo(index) {
  if (index === current.value) return;
  previous.value = current.value;
  current.value = index;
}

function next() {
  goTo((current.value + 1) % SLIDE_COUNT);
}

function slideClass(index) {
  if (index === current.value) return "auth-slide--active";
  if (index === previous.value) return "auth-slide--prev";
  return "auth-slide--next";
}

onMounted(() => {
  timer = setInterval(next, SLIDE_INTERVAL);
});

onUnmounted(() => {
  clearInterval(timer);
});
</script>

<template>
  <aside class="auth-card__brand">
    <div class="auth-brand__blob auth-brand__blob--1" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--2" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--3" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--4" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--5" aria-hidden="true"></div>
    <div class="auth-brand__sheen" aria-hidden="true"></div>
    <div class="auth-brand__grid" aria-hidden="true"></div>
    <div class="auth-brand__sparkles" aria-hidden="true">
      <span v-for="n in 7" :key="n" class="auth-brand__sparkle" :class="`auth-brand__sparkle--${n}`"></span>
    </div>

    <div class="auth-brand__logo">
      <img src="../assets/a360-mark.svg" alt="" class="auth-brand__logo-icon" />
      <span class="auth-brand__logo-text">A360 ASSISTANT</span>
    </div>

    <div class="auth-slider" aria-hidden="true">
      <div class="auth-slide" :class="slideClass(0)">
        <div class="auth-slide-photo">
          <img :src="slide1Photo" alt="" width="1200" height="800" fetchpriority="high" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(1)">
        <div class="auth-slide-photo">
          <img :src="slide2Photo" alt="" width="1200" height="800" loading="lazy" decoding="async" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(2)">
        <div class="auth-slide-photo">
          <img :src="slide3Photo" alt="" width="1200" height="800" loading="lazy" decoding="async" />
        </div>
      </div>
    </div>

    <div class="auth-brand__copy">
      <h2 class="auth-brand__title">{{ t("auth.visual.title") }}</h2>
      <p class="auth-brand__desc">{{ t("auth.visual.desc") }}</p>
    </div>

    <div class="auth-dots" role="tablist" :aria-label="t('auth.visual.dotsLabel')">
      <button
        v-for="idx in SLIDE_COUNT"
        :key="idx"
        type="button"
        class="auth-dot"
        :class="{ 'auth-dot--active': idx - 1 === current }"
        role="tab"
        :aria-selected="idx - 1 === current"
        :aria-label="t('auth.visual.slideLabel', { n: idx })"
        @click="goTo(idx - 1)"
      ></button>
    </div>
  </aside>
</template>
