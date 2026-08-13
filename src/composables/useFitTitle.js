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
    // 이미 스케일이 1(또는 미설정 — 기본값도 1)이면 리셋 write를 건너뛴다. 그래야 마운트
    // 직후 첫 측정(항상 이 경우)에서 "스타일 write 직후 레이아웃 read"로 강제 리플로우가
    // 발생하지 않는다 — write 없이 바로 읽으면 이미 진행 중이던 레이아웃 계산에 얹혀가므로
    // 강제(synchronous forced reflow)가 아니다. 리사이즈 등으로 이전에 축소된 스케일이
    // 남아 있는 경우에만 실제로 리셋이 필요해 write-then-read를 피할 수 없다.
    const currentScale = el.style.getPropertyValue("--title-scale");
    if (currentScale && currentScale !== "1") {
      el.style.setProperty("--title-scale", "1");
    }
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
