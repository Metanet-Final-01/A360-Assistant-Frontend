import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";

// 패널 타이틀(.panel__header h2)은 로케일에 따라 길이가 크게 달라진다(예: 영어가 한글보다
// 길어져 헤더 폭을 넘침) — 줄바꿈 대신 폰트 크기를 줄여 한 줄에 맞춘다. 실제 렌더 폭
// (scrollWidth vs clientWidth)을 재서 --title-scale CSS 변수에 반영하고, style.css가
// font-size: calc(1rem * var(--title-scale, 1))로 이를 적용한다. 그래도 못 맞추는
// 극단적인 경우를 대비해 CSS의 nowrap+ellipsis는 그대로 안전망으로 둔다.
const MIN_SCALE = 0.62;

export function useFitTitle(elRef, textSource) {
  function fit() {
    const el = elRef.value;
    if (!el) return;
    el.style.setProperty("--title-scale", "1");
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow > 0.5) {
      const scale = Math.max(MIN_SCALE, el.clientWidth / el.scrollWidth);
      el.style.setProperty("--title-scale", scale.toFixed(3));
    }
  }

  let resizeObserver = null;

  onMounted(() => {
    fit();
    resizeObserver = new ResizeObserver(fit);
    if (elRef.value) resizeObserver.observe(elRef.value);
  });

  onBeforeUnmount(() => resizeObserver?.disconnect());

  // 로케일 전환 등으로 타이틀 문구 자체가 바뀌면(길이가 달라지므로) 다시 잰다.
  watch(textSource, async () => {
    await nextTick();
    fit();
  });
}
