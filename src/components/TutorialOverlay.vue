<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const emit = defineEmits(["close"]);
const { t, tm } = useI18n();

// selectors는 우선순위 순서 — 앞의 것이 화면에 없으면(예: 챗봇이 도킹 해제된 상태) 뒤의 것을 하이라이트한다.
// title/body는 locales/*.js의 tutorial.steps 배열에서 가져온다 — selectors는 DOM 타겟이라 번역 대상이 아니므로 여기 그대로 둔다.
const STEP_SELECTORS = [
  undefined,
  ['[data-tour="upload"]'],
  ['[data-tour="analysis"]'],
  ['[data-tour="recommend"]'],
  [".chat-popup--docked", ".chat-fab"],
  ['[data-tour="sidebar-nav"]'],
];

const steps = computed(() =>
  tm("tutorial.steps").map((_, idx) => ({
    selectors: STEP_SELECTORS[idx],
    title: t(`tutorial.steps.${idx}.title`),
    body: t(`tutorial.steps.${idx}.body`),
  })),
);

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

// 타겟이 자신은 스크롤 없이 전체 콘텐츠 높이만큼 늘어나고, 실제 스크롤은 조상 요소
// (예: analysis-results는 늘어나기만 하고 panel__body가 overflow-y:auto로 스크롤됨)가
// 담당하는 경우, getBoundingClientRect()는 화면에 실제로 보이는 범위를 넘어서는 값을
// 돌려준다 — 스크롤되는 조상들의 가시 영역과 교집합을 구해 실제 보이는 범위로 잘라낸다.
function getVisibleRect(el) {
  const rect = el.getBoundingClientRect();
  let { top, left, right, bottom } = rect;

  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const pRect = parent.getBoundingClientRect();
    if (/(auto|scroll)/.test(style.overflowY)) {
      top = Math.max(top, pRect.top);
      bottom = Math.min(bottom, pRect.bottom);
    }
    if (/(auto|scroll)/.test(style.overflowX)) {
      left = Math.max(left, pRect.left);
      right = Math.min(right, pRect.right);
    }
    parent = parent.parentElement;
  }

  top = Math.min(top, bottom);
  left = Math.min(left, right);

  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

async function layout() {
  const step = steps.value[current.value];
  const target = findTarget(step);

  if (!target) {
    spotlightStyle.value = null;
    cardStyle.value = {};
    return;
  }

  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = getVisibleRect(target);
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
  if (current.value >= steps.value.length - 1) {
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
  <div class="tour-overlay" role="dialog" aria-modal="true" :aria-label="t('tutorial.ariaLabel')">
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
        <button type="button" class="tour-card__skip" @click="emit('close')">{{ t("tutorial.skip") }}</button>
        <div class="tour-card__dots" aria-hidden="true">
          <span
            v-for="(_, idx) in steps"
            :key="idx"
            class="tour-card__dot"
            :class="{ 'tour-card__dot--active': idx === current }"
          ></span>
        </div>
        <div class="tour-card__nav">
          <button v-if="current > 0" type="button" class="tour-card__prev" @click="prev">{{ t("tutorial.prev") }}</button>
          <button type="button" class="tour-card__next" @click="next">
            {{ current === steps.length - 1 ? t("tutorial.start") : t("tutorial.next") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
