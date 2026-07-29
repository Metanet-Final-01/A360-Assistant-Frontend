<script setup>
import { ref, watch, onBeforeUnmount } from "vue";

// 고대비 모드나 Chrome의 Windows 11 네이티브 스크롤바 등, 브라우저가 페이지 CSS를 무시하고
// OS 스크롤바(화살표 포함)를 강제로 그리는 환경이 있다 — ::-webkit-scrollbar-*는 그런
// 환경에서 전혀 먹히지 않는다(순수 CSS로는 못 이긴다). 대신 target의 네이티브 스크롤바는
// display:none으로 완전히 숨기고(이건 거의 모든 브라우저·설정에서 확실히 먹힌다), 그 자리에
// scrollTop을 그대로 반영하는 손잡이를 이 컴포넌트가 직접 그린다. 실제 스크롤(휠·터치·키보드)은
// 여전히 target의 네이티브 overflow가 담당하므로 기존 scrollTop 기반 로직과 충돌하지 않는다 —
// target을 감싸거나 대체하지 않고, 그 안에 이 손잡이 하나만 얹는 방식이라 가능한 절충이다.
const props = defineProps({
  // 스크롤 대상 DOM 엘리먼트. 부모가 template ref(예: messagesRef)를 :target="messagesRef"로
  // 넘기면, Vue가 템플릿에서 top-level ref를 자동 언랩하기 때문에 여기 props.target은 이미
  // ref가 아니라 언랩된 엘리먼트(또는 마운트 전이라 null)로 들어온다 — .value로 한 번 더
  // 까려고 하면 undefined가 되어 아무것도 안 그려진다.
  target: { type: Object, default: null },
});

const MIN_THUMB = 24;

const visible = ref(false);
const dragging = ref(false);
const thumbTop = ref(0);
const thumbHeight = ref(0);

function update() {
  const el = props.target;
  if (!el) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight - clientHeight < 1) {
    visible.value = false;
    return;
  }
  visible.value = true;
  const height = Math.max((clientHeight / scrollHeight) * clientHeight, MIN_THUMB);
  const travel = clientHeight - height;
  const ratio = scrollTop / (scrollHeight - clientHeight);
  thumbHeight.value = height;
  // 손잡이는 target 내부의 absolute 자식이라 스크롤에 따라 콘텐츠와 함께 밀려난다 —
  // scrollTop을 더해 뷰포트 기준으로는 항상 같은 자리(travel*ratio)에 보이도록 상쇄한다.
  thumbTop.value = scrollTop + travel * ratio;
}

let rafId = null;
function scheduleUpdate() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    update();
  });
}

function onPointerDown(event) {
  const el = props.target;
  if (!el || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  dragging.value = true;
  const startClientY = event.clientY;
  const startScrollTop = el.scrollTop;
  const { scrollHeight, clientHeight } = el;
  const travel = clientHeight - thumbHeight.value;

  function onMove(moveEvent) {
    if (travel <= 0) return;
    const deltaY = moveEvent.clientY - startClientY;
    const scrollRange = scrollHeight - clientHeight;
    el.scrollTop = startScrollTop + (deltaY / travel) * scrollRange;
  }
  function onUp() {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

let resizeObserver = null;
let mutationObserver = null;

function teardown(el) {
  el?.removeEventListener("scroll", update);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
}

watch(
  () => props.target,
  (el, prevEl) => {
    teardown(prevEl);
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    // 컨테이너 자체 크기 변화(창 크기 조절 등)와 내용물 크기 변화(메시지 추가·스트리밍 등)는
    // 서로 다른 신호라 각각 관찰해야 한다 — ResizeObserver는 el 자신의 border-box만 보고,
    // 자식이 늘어나 scrollHeight만 커지는 경우는 못 잡는다.
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(el);
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    update();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  teardown(props.target);
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div
    v-show="visible"
    class="scroll-thumb"
    :class="{ 'scroll-thumb--dragging': dragging }"
    aria-hidden="true"
    :style="{ transform: `translateY(${thumbTop}px)`, height: `${thumbHeight}px` }"
    @pointerdown="onPointerDown"
  ></div>
</template>
