<script setup>
import { onMounted, onUnmounted, ref } from "vue";

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
        <svg viewBox="0 0 220 160" fill="none">
          <circle cx="176" cy="34" r="30" fill="rgba(255,255,255,0.08)" />
          <circle cx="30" cy="128" r="22" fill="rgba(255,255,255,0.08)" />
          <circle
            cx="176"
            cy="34"
            r="30"
            stroke="rgba(255,255,255,0.35)"
            stroke-width="1.2"
            stroke-dasharray="3 5"
          />
          <rect x="66" y="34" width="88" height="108" rx="12" fill="rgba(255,255,255,0.12)" />
          <rect
            x="66"
            y="34"
            width="88"
            height="108"
            rx="12"
            stroke="rgba(255,255,255,0.85)"
            stroke-width="1.8"
          />
          <path d="M84 60h52M84 78h52M84 96h34" stroke="rgba(255,255,255,0.85)" stroke-width="2.2" stroke-linecap="round" />
          <path
            d="M84 114l10 10 16-18"
            stroke="#8fe0c8"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="110" cy="20" r="17" fill="#8fe0c8" />
          <path
            d="M110 27v-14m0 0-6 6m6-6 6 6"
            stroke="var(--brand-navy)"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <div class="auth-slide" :class="slideClass(1)">
        <svg viewBox="0 0 220 160" fill="none">
          <circle cx="34" cy="30" r="24" fill="rgba(255,255,255,0.08)" />
          <circle cx="188" cy="122" r="28" fill="rgba(255,255,255,0.08)" />
          <path d="M50 90h120" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-dasharray="4 6" />
          <g>
            <circle cx="50" cy="90" r="20" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" />
            <path d="M42 90l5 5 11-12" stroke="#8fe0c8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </g>
          <g>
            <circle cx="110" cy="60" r="20" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" />
            <path d="M102 60l5 5 11-12" stroke="#8fe0c8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </g>
          <g>
            <circle cx="170" cy="90" r="20" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.95)" stroke-width="2" />
            <path d="M162 90l5 5 11-12" stroke="#ffe08a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
          </g>
          <path d="M62 82l38-16" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-dasharray="4 6" />
          <path d="M126 68l34 14" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-dasharray="4 6" />
          <path d="M60 135l6-8m4 8-3-9m10 8 1-9" stroke="rgba(255,255,255,0.55)" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </div>

      <div class="auth-slide" :class="slideClass(2)">
        <svg viewBox="0 0 220 160" fill="none">
          <circle cx="182" cy="36" r="26" fill="rgba(255,255,255,0.08)" />
          <circle cx="26" cy="120" r="20" fill="rgba(255,255,255,0.08)" />
          <path
            d="M50 40h96a14 14 0 0 1 14 14v34a14 14 0 0 1-14 14H96l-22 18v-18H50a14 14 0 0 1-14-14V54a14 14 0 0 1 14-14Z"
            fill="rgba(255,255,255,0.14)"
            stroke="rgba(255,255,255,0.9)"
            stroke-width="1.8"
          />
          <circle cx="80" cy="75" r="4.5" fill="#8fe0c8" />
          <circle cx="98" cy="75" r="4.5" fill="#8fe0c8" />
          <circle cx="116" cy="75" r="4.5" fill="#8fe0c8" />
          <path
            d="M148 108h34a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10h-8l-12 12v-12h-14a10 10 0 0 1-10-10v-18a10 10 0 0 1 10-10Z"
            fill="rgba(255,255,255,0.2)"
            stroke="#ffe08a"
            stroke-width="1.8"
          />
          <path d="M166 128h20M166 136h12" stroke="var(--brand-navy)" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </div>
    </div>

    <div class="auth-brand__copy">
      <h2 class="auth-brand__title">환영합니다!</h2>
      <p class="auth-brand__desc">
        업무정의서를 분석하고 A360 작업을 추천하며,<br />
        대화로 다듬어가는 자동화 도우미입니다.
      </p>
    </div>

    <div class="auth-dots" role="tablist" aria-label="소개 이미지 넘기기">
      <button
        v-for="idx in SLIDE_COUNT"
        :key="idx"
        type="button"
        class="auth-dot"
        :class="{ 'auth-dot--active': idx - 1 === current }"
        role="tab"
        :aria-selected="idx - 1 === current"
        :aria-label="`${idx}번째 이미지 보기`"
        @click="goTo(idx - 1)"
      ></button>
    </div>
  </aside>
</template>
