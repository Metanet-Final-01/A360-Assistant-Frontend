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

function startSlideTimer() {
  if (timer) return;
  timer = setInterval(next, SLIDE_INTERVAL);
}

function stopSlideTimer() {
  clearInterval(timer);
  timer = null;
}

// 탭이 백그라운드로 가면(다른 창/탭 전환) blob/sheen/sparkle 애니메이션과 슬라이드 전환 타이머를
// 멈춘다 — 아무도 보고 있지 않은 로그인 화면이 계속 컴포지팅되며 CPU/GPU/배터리를 낭비하지
// 않게 한다. 다시 보이면 즉시 재개하므로(탭 전환 자체가 흔한 조작) 화면에 보이는 동안에는
// 이 로직이 전혀 개입하지 않아 시각적 차이가 없다.
const pageHidden = ref(document.hidden);

function handleVisibilityChange() {
  pageHidden.value = document.hidden;
  if (document.hidden) {
    stopSlideTimer();
  } else {
    startSlideTimer();
  }
}

onMounted(() => {
  // 이미 백그라운드 탭/창에서 마운트되는 경우(예: 로그인 화면이 새 탭으로 열렸지만 포커스는
  // 다른 탭에 있는 경우) 무조건 타이머부터 켜면, 이후 visibilitychange가 한 번도 안 와서
  // (지금 상태 그대로 유지되는 한 이벤트가 안 뜬다) 꺼줄 계기가 없다 — 처음부터 현재 가시성을
  // 반영해 시작한다.
  if (!document.hidden) startSlideTimer();
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onUnmounted(() => {
  stopSlideTimer();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <aside class="auth-card__brand" :class="{ 'auth-card__brand--paused': pageHidden }">
    <div class="auth-brand__blob auth-brand__blob--1" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--2" aria-hidden="true"></div>
    <div class="auth-brand__blob auth-brand__blob--4" aria-hidden="true"></div>
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
          <img :src="slide1Photo" alt="" width="900" height="600" fetchpriority="high" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(1)">
        <div class="auth-slide-photo">
          <img :src="slide2Photo" alt="" width="900" height="600" loading="lazy" decoding="async" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(2)">
        <div class="auth-slide-photo">
          <img :src="slide3Photo" alt="" width="900" height="600" loading="lazy" decoding="async" />
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
