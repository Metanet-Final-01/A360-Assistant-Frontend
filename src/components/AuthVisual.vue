<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import slide1Photo from "../assets/login1.png";
import slide2Photo from "../assets/login2.png";
import slide3Photo from "../assets/login3.png";

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
          <img :src="slide1Photo" alt="" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(1)">
        <div class="auth-slide-photo">
          <img :src="slide2Photo" alt="" />
        </div>
      </div>

      <div class="auth-slide" :class="slideClass(2)">
        <div class="auth-slide-photo">
          <img :src="slide3Photo" alt="" />
        </div>
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
