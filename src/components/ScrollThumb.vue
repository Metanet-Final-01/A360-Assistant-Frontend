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
  // 루트 엘리먼트 태그 — 기본은 div지만, <ul> 안에 직접 얹는 경우(SidebarSessionList) 등
  // 부모 마크업이 특정 자식 태그를 요구하면 "li" 등으로 바꿀 수 있다(Qodo 리뷰 — ul > div는
  // 시맨틱/접근성 가정을 깨는 잘못된 마크업이다).
  tag: { type: String, default: "div" },
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
  // MIN_THUMB로 바닥을 두되 clientHeight를 넘지 않게 천장도 씌운다(Qodo 리뷰) — 안 그러면
  // 뷰포트 자체가 MIN_THUMB보다 작은(아주 좁은 패널) 스크롤 가능 컨테이너에서 손잡이가
  // 트랙보다 커져 travel이 음수가 되고, 위치도 어긋나고 드래그(onMove)도 travel<=0이라 먹통이 된다.
  const height = Math.min(clientHeight, Math.max((clientHeight / scrollHeight) * clientHeight, MIN_THUMB));
  const travel = clientHeight - height;
  // 클램프 후에도 travel<=0이면(뷰포트가 MIN_THUMB보다 작아 손잡이가 트랙을 꽉 채움) 커스텀
  // 손잡이를 숨긴다 — 드래그가 의미 없어질뿐더러, 실제 스크롤(휠·터치·키보드)은 target의
  // 네이티브 overflow가 계속 맡으므로 숨겨도 스크롤 자체는 그대로 된다.
  if (travel <= 0) {
    visible.value = false;
    return;
  }
  visible.value = true;
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

// 드래그 도중 pointercancel(OS 제스처·멀티터치 취소·포커스 전환 등)이나 컴포넌트 언마운트가
// 끼어들 수 있다 — pointerup만 정리하면 그 경우 window 리스너가 계속 남아 언마운트된 target의
// scrollTop을 계속 건드리고, dragging 상태도 true로 고착된다(Qodo 리뷰). 진행 중인 드래그의
// 정리 함수를 바깥 스코프에 보관해 onBeforeUnmount에서도 부를 수 있게 한다.
let activeDragCleanup = null;

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
  function stopDrag() {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    activeDragCleanup = null;
  }
  activeDragCleanup = stopDrag;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
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
  activeDragCleanup?.();
  teardown(props.target);
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <component
    :is="tag"
    v-show="visible"
    class="scroll-thumb"
    :class="{ 'scroll-thumb--dragging': dragging }"
    aria-hidden="true"
    :style="{ transform: `translateY(${thumbTop}px)`, height: `${thumbHeight}px` }"
    @pointerdown="onPointerDown"
  ></component>
</template>
