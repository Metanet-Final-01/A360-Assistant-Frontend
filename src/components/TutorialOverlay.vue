<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const emit = defineEmits(["close"]);

// selectors는 우선순위 순서 — 앞의 것이 화면에 없으면(예: 챗봇이 도킹 해제된 상태) 뒤의 것을 하이라이트한다.
const steps = [
  {
    title: "A360 Assistant에 오신 것을 환영합니다 👋",
    body: "업무정의서를 분석해 단계별 업무 흐름과 A360 자동화 흐름도를 추천해 주는 도우미입니다. 주요 기능을 간단히 소개해 드릴게요.",
  },
  {
    selectors: ['[data-tour="upload"]'],
    title: "업무정의서 업로드",
    body: "PDF · PPT · PPTX · DOCX 파일을 드래그해서 올리거나, 파일 없이 텍스트로 직접 업무 내용을 입력할 수 있습니다. 업로드가 끝나면 분석을 시작하세요.",
  },
  {
    selectors: ['[data-tour="analysis"]'],
    title: "분석 결과 확인 · 편집",
    body: "AI가 업무를 단계별로 정리해 보여줍니다. 단계를 드래그로 재정렬하거나 수정·삭제할 수 있습니다.",
  },
  {
    selectors: ['[data-tour="recommend"]'],
    title: "추천 흐름도 상세",
    body: "'흐름도 보기'로 A360 액션 추천 흐름도를 생성·확인할 수 있고, 이 패널에서 단계별 액션과 파라미터 상세를 바로 볼 수 있습니다.",
  },
  {
    selectors: [".chat-popup--docked", ".chat-fab"],
    title: "AI 챗봇",
    body: "분석 진행 상태를 확인하고, 결과에 대해 질문하거나 대화로 수정을 요청할 수 있습니다. 헤더를 드래그해 창을 자유롭게 옮길 수도 있어요.",
  },
  {
    selectors: ['[data-tour="sidebar-nav"]'],
    title: "메뉴 · 아카이브",
    body: "아카이브에서 지난 분석 기록과 대화를 다시 볼 수 있습니다. 이 소개는 사이드바의 '기능 소개' 버튼으로 언제든 다시 볼 수 있어요.",
  },
];

const current = ref(0);
const spotlightStyle = ref(null); // null이면 대상 없는 스텝 → 카드만 중앙 표시
const cardStyle = ref({});
const cardRef = ref(null);

const SPOT_PAD = 8;
const GAP = 18;
const EDGE = 12;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max < min ? min : max);
}

function findTarget(step) {
  for (const selector of step.selectors ?? []) {
    const el = document.querySelector(selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 4 && rect.height > 4) return el;
    }
  }
  return null;
}

async function layout() {
  const step = steps[current.value];
  const target = findTarget(step);

  if (!target) {
    spotlightStyle.value = null;
    cardStyle.value = {};
    return;
  }

  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = target.getBoundingClientRect();
  spotlightStyle.value = {
    top: `${rect.top - SPOT_PAD}px`,
    left: `${rect.left - SPOT_PAD}px`,
    width: `${rect.width + SPOT_PAD * 2}px`,
    height: `${rect.height + SPOT_PAD * 2}px`,
  };

  await nextTick();
  const card = cardRef.value;
  if (!card) return;

  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 대상 기준 오른쪽 → 왼쪽 → 아래 → 위 순으로 여유 있는 방향에 배치
  let top;
  let left;
  if (rect.right + GAP + cw <= vw - EDGE) {
    left = rect.right + GAP;
    top = rect.top;
  } else if (rect.left - GAP - cw >= EDGE) {
    left = rect.left - GAP - cw;
    top = rect.top;
  } else if (rect.bottom + GAP + ch <= vh - EDGE) {
    left = rect.left;
    top = rect.bottom + GAP;
  } else {
    left = rect.left;
    top = rect.top - GAP - ch;
  }

  cardStyle.value = {
    top: `${clamp(top, EDGE, vh - ch - EDGE)}px`,
    left: `${clamp(left, EDGE, vw - cw - EDGE)}px`,
  };
}

function next() {
  if (current.value >= steps.length - 1) {
    emit("close");
    return;
  }
  current.value += 1;
}

function prev() {
  if (current.value > 0) current.value -= 1;
}

function onKeydown(event) {
  if (event.key === "Escape") emit("close");
  else if (event.key === "ArrowRight" || event.key === "Enter") next();
  else if (event.key === "ArrowLeft") prev();
}

watch(current, () => layout());

onMounted(() => {
  layout();
  window.addEventListener("resize", layout);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", layout);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="tour-overlay" role="dialog" aria-modal="true" aria-label="기능 소개 튜토리얼">
    <div v-if="!spotlightStyle" class="tour-overlay__backdrop"></div>
    <div v-else class="tour-overlay__spotlight" :style="spotlightStyle"></div>

    <div
      ref="cardRef"
      class="tour-card"
      :class="{ 'tour-card--centered': !spotlightStyle }"
      :style="cardStyle"
    >
      <span class="tour-card__badge">{{ current + 1 }} / {{ steps.length }}</span>
      <h3 class="tour-card__title">{{ steps[current].title }}</h3>
      <p class="tour-card__body">{{ steps[current].body }}</p>

      <div class="tour-card__footer">
        <button type="button" class="tour-card__skip" @click="emit('close')">건너뛰기</button>
        <div class="tour-card__dots" aria-hidden="true">
          <span
            v-for="(_, idx) in steps"
            :key="idx"
            class="tour-card__dot"
            :class="{ 'tour-card__dot--active': idx === current }"
          ></span>
        </div>
        <div class="tour-card__nav">
          <button v-if="current > 0" type="button" class="tour-card__prev" @click="prev">이전</button>
          <button type="button" class="tour-card__next" @click="next">
            {{ current === steps.length - 1 ? "시작하기" : "다음" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
