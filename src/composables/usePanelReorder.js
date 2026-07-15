import { computed, reactive, ref } from "vue";

// 로그아웃 시 초기화해야 하는 저장 키 — auth 스토어(logout)와 App.vue의
// usePanelReorder 호출부가 같은 문자열을 쓰도록 여기 한 곳에서만 정의한다.
export const ANALYSIS_PANEL_ORDER_KEY = "a360.panelOrder.analysis";

// 핸들 하나가 차지하는 트랙 폭 — 기존 그리드 gap(24px)을 그대로 대체해, 리사이즈 핸들이
// 생겨도 패널 사이 간격이 지금과 똑같이 보이게 한다(핸들이 그 24px 안에서 그려짐).
export const PANEL_GAP_PX = 24;

// 좌표 아래 있는 패널의 키를 찾는다. 네이티브 HTML5 드래그는 고스트 이미지가 히트테스트에
// 끼지 않아 event.target을 바로 써도 되지만, 포인터 이벤트로 움직이는 플로팅 챗봇 팝업은
// 커서 아래 실제로 자신이 깔려 있어 elementFromPoint가 그 팝업 자신을 잡아버린다 — 그래서
// 호출 전에 팝업의 pointer-events를 잠깐 꺼 두는 건 호출부(ChatWidget) 책임으로 둔다.
function panelKeyAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest?.("[data-panel-key]")?.dataset.panelKey ?? null;
}

// .chat-widget처럼 루트가 display:contents라 자기 자신은 박스가 없는 패널도 있어,
// 실제로 그려지는(rect가 있는) 자식까지 내려가서 찾는다.
function boxElOf(panelEl) {
  if (panelEl.getClientRects().length) return panelEl;
  return Array.from(panelEl.children).find((child) => child.getClientRects().length) ?? panelEl;
}

function boxElByKey(key) {
  const el = document.querySelector(`[data-panel-key="${key}"]`);
  return el ? boxElOf(el) : null;
}

// 페이지 그리드 안 패널(업로드/분석 결과/도킹된 챗봇 등)의 가로 배치를 드래그앤드롭으로
// 바꾸고 localStorage에 저장한다. 순서는 CSS order(--panel-order)와 그리드 열 폭
// (--grid-cols)으로만 반영하므로 DOM 구조는 그대로다.
//
// 드래그 시작은 각 패널 헤더의 [data-panel-handle] 그립에서만 허용한다. 이렇게 하면
// 같은 화면에서 이미 네이티브 드래그를 쓰는 것들 — 분석 결과 카드(rec-card) 순서 변경,
// 업로드 드롭존의 파일 드래그 — 과 이벤트가 섞이지 않는다.
//
// begin/setDropTarget/commitDrop/cancelDrag는 컨테이너의 네이티브 드래그(containerHandlers)와
// 플로팅 챗봇의 포인터 드래그(ChatWidget) 둘 다에서 같은 순서 상태를 공유하려고 밖으로 노출한다 —
// 챗봇을 도킹 존 안의 특정 패널 위에 놓으면(마우스 위치 기준) 그 패널 자리로 들어가고,
// 패널이 아닌 빈 자리에 놓으면 기존 저장된 자리를 그대로 유지한다.
export function usePanelReorder({
  storageKey,
  defaultOrder,
  defaultWeights,
  minWidths,
  isVisible = () => true,
}) {
  function readStored() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "");
      const valid =
        Array.isArray(parsed) &&
        parsed.length === defaultOrder.length &&
        defaultOrder.every((key) => parsed.includes(key));
      if (valid) return parsed;
    } catch {
      /* 저장값이 없거나 깨졌으면 기본 순서 사용 */
    }
    return null;
  }

  const widthsStorageKey = `${storageKey}:widths`;
  function readStoredWeights() {
    try {
      const parsed = JSON.parse(localStorage.getItem(widthsStorageKey) ?? "");
      const valid =
        parsed &&
        typeof parsed === "object" &&
        defaultOrder.every((key) => typeof parsed[key] === "number" && parsed[key] > 0);
      if (valid) return parsed;
    } catch {
      /* 저장값이 없거나 깨졌으면 기본 비율 사용 */
    }
    return null;
  }

  const order = ref(readStored() ?? [...defaultOrder]);
  const weights = ref(readStoredWeights() ?? { ...defaultWeights });
  const draggingKey = ref(null);
  const dropTargetKey = ref(null);
  const resizingBoundary = ref(null);

  // 도킹 해제된 챗봇처럼 지금 그리드에 안 보이는 패널도 트랙 자체는 항상 남겨 두고
  // (minmax(0px,0fr)로 접어서) 폭만 0으로 만든다 — 트랙 개수·구성이 보이기/숨기기 상태와
  // 무관하게 항상 같아야, 도킹 해제/복귀 때 grid-template-columns가 값만 부드럽게
  // 전환되고(브라우저가 같은 모양의 트랙 리스트만 보간한다) 나머지 패널이 그 자리를
  // 애니메이션으로 채워 들어간다. 숨은 패널과 맞닿은 핸들도 둘 중 하나만 접어(0px)
  // 보이는 패널 사이엔 정확히 하나의 정상 간격만 남긴다.
  const layout = computed(() => {
    const keys = order.value;
    const tracks = [];
    const boundaries = [];
    const collapsedFor = new Set();
    keys.forEach((key, i) => {
      const visible = isVisible(key);
      tracks.push(visible ? `minmax(${minWidths[key]}px, ${weights.value[key]}fr)` : "minmax(0px, 0fr)");
      if (i === keys.length - 1) return;
      const leftKey = key;
      const rightKey = keys[i + 1];
      const leftHidden = !visible;
      const rightHidden = !isVisible(rightKey);
      let collapse = false;
      if (leftHidden && !collapsedFor.has(leftKey)) {
        collapse = true;
        collapsedFor.add(leftKey);
      } else if (rightHidden && !collapsedFor.has(rightKey)) {
        collapse = true;
        collapsedFor.add(rightKey);
      }
      tracks.push(collapse ? "0px" : `${PANEL_GAP_PX}px`);
      boundaries.push({
        key: `${leftKey}::${rightKey}`,
        leftKey,
        rightKey,
        order: i * 2 + 1,
        interactive: !leftHidden && !rightHidden,
      });
    });
    return { gridCols: tracks.join(" "), boundaries };
  });

  const gridStyle = computed(() => ({ "--grid-cols": layout.value.gridCols }));

  // 리사이즈 핸들 사이사이 배치 — 패널은 짝수 order(0,2,4…), 핸들은 그 사이 홀수
  // order(1,3…)를 써서, 순서가 바뀌어도(드래그앤드롭) 항상 자기 좌우 패널 사이에 남는다.
  const boundaries = computed(() => layout.value.boundaries);

  // 각 패널(또는 컴포넌트 루트)에 v-bind로 뿌리는 속성 묶음.
  // ChatWidget처럼 루트가 display: contents여도 --panel-order가 자식 팝업까지
  // 상속되므로 동일하게 쓸 수 있다.
  function panelProps(key) {
    const idx = order.value.indexOf(key);
    return {
      "data-panel-key": key,
      style: { "--panel-order": String(idx === -1 ? 0 : idx * 2) },
      class: {
        "panel-reorder-source": draggingKey.value === key,
        "panel-reorder-target": dropTargetKey.value === key && draggingKey.value !== key,
      },
    };
  }

  function persistWeights() {
    localStorage.setItem(widthsStorageKey, JSON.stringify(weights.value));
  }

  // 좌우 두 패널의 폭을 deltaPx만큼 맞바꾼다(하나는 늘고 다른 하나는 그만큼 줄어든다) —
  // 나머지 패널의 fr 합은 그대로라 다른 패널 폭은 전혀 바뀌지 않는다. 매번 실측 rect로
  // px↔fr 비율을 다시 구하므로, 한쪽이 최소 폭에 걸려도(deltaWeight가 0에 가까워짐) 다음
  // 프레임에 자연히 멈추고, 반대로 움직이면 바로 다시 반응한다.
  function resizeByPx(leftKey, rightKey, deltaPx) {
    const leftEl = boxElByKey(leftKey);
    const rightEl = boxElByKey(rightKey);
    if (!leftEl || !rightEl) return;
    const leftRect = leftEl.getBoundingClientRect();
    const rightRect = rightEl.getBoundingClientRect();
    const leftWeight = weights.value[leftKey];
    const rightWeight = weights.value[rightKey];
    if (!leftWeight || !rightWeight) return;
    const pxPerFr = leftRect.width / leftWeight;
    if (!Number.isFinite(pxPerFr) || pxPerFr <= 0) return;
    const maxGrow = Math.max(rightRect.width - minWidths[rightKey], 0); // 왼쪽이 늘 수 있는 한도(오른쪽이 최소 폭에 닿기 전까지)
    const maxShrink = Math.max(leftRect.width - minWidths[leftKey], 0); // 왼쪽이 줄 수 있는 한도(자기 최소 폭에 닿기 전까지)
    const clamped = Math.min(maxGrow, Math.max(-maxShrink, deltaPx));
    const deltaWeight = clamped / pxPerFr;
    if (deltaWeight === 0) return;
    weights.value = { ...weights.value, [leftKey]: leftWeight + deltaWeight, [rightKey]: rightWeight - deltaWeight };
  }

  let resizeState = null;

  function onResizeMove(event) {
    if (!resizeState) return;
    const deltaPx = event.clientX - resizeState.lastX;
    resizeState.lastX = event.clientX;
    resizeByPx(resizeState.leftKey, resizeState.rightKey, deltaPx);
  }

  function endResize() {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    if (resizeState) persistWeights();
    resizeState = null;
    resizingBoundary.value = null;
  }

  function beginResize(leftKey, rightKey, event) {
    if (!isVisible(leftKey) || !isVisible(rightKey)) return; // 한쪽이 숨겨져 접힌 핸들은 조정 불가
    event.preventDefault();
    resizeState = { leftKey, rightKey, lastX: event.clientX };
    resizingBoundary.value = `${leftKey}::${rightKey}`;
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
  }

  // 키보드로도 경계를 조정할 수 있게(그립 위 화살표 키) — 한 번에 24px 상당만큼 옮긴다.
  function nudgeResize(leftKey, rightKey, deltaPx) {
    if (!isVisible(leftKey) || !isVisible(rightKey)) return;
    resizeByPx(leftKey, rightKey, deltaPx);
    persistWeights();
  }

  function resetWidths() {
    weights.value = { ...defaultWeights };
    localStorage.removeItem(widthsStorageKey);
  }

  function beginDrag(key) {
    if (draggingKey.value !== key) draggingKey.value = key;
  }

  function setDropTarget(key) {
    const next = key && key !== draggingKey.value && isVisible(key) ? key : null;
    if (dropTargetKey.value !== next) dropTargetKey.value = next;
  }

  function commitDrop() {
    const key = draggingKey.value;
    const targetKey = dropTargetKey.value;
    if (key && targetKey) {
      // 드래그한 패널을 대상 패널의 원래 자리로 옮긴다(사이 패널은 한 칸씩 밀림).
      const next = [...order.value];
      const from = next.indexOf(key);
      const to = next.indexOf(targetKey);
      if (from !== -1 && to !== -1) {
        next.splice(from, 1);
        next.splice(to, 0, key);
        order.value = next;
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
    }
    cancelDrag();
  }

  function cancelDrag() {
    draggingKey.value = null;
    dropTargetKey.value = null;
  }

  // 로그아웃 시 호출 — 이 컴포저블은 App.vue 루트처럼 로그인 세션을 넘나들며 살아있는
  // 곳에서도 쓰이므로, localStorage만 지워서는 부족하고 메모리상 order/weights도 같이 되돌려야 한다.
  function resetToDefault() {
    order.value = [...defaultOrder];
    localStorage.removeItem(storageKey);
    cancelDrag();
    resetWidths();
  }

  const containerHandlers = {
    dragstart(event) {
      // 그립 이외에서 시작된 드래그(rec-card 등)는 그대로 통과시킨다.
      const handle = event.target.closest?.("[data-panel-handle]");
      if (!handle) return;
      const panelEl = handle.closest("[data-panel-key]");
      if (!panelEl) return;
      const key = panelEl.dataset.panelKey;
      beginDrag(key);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-a360-panel", key);
      const boxEl = boxElOf(panelEl);
      const rect = boxEl.getBoundingClientRect();
      event.dataTransfer.setDragImage(boxEl, event.clientX - rect.left, event.clientY - rect.top);
    },
    dragover(event) {
      if (!draggingKey.value) return; // 파일·카드 드래그에는 관여하지 않는다
      const key = panelKeyAtPoint(event.clientX, event.clientY);
      if (!key || !isVisible(key)) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(key);
    },
    dragleave(event) {
      if (!draggingKey.value) return;
      const related = event.relatedTarget;
      if (!related || !event.currentTarget.contains(related)) {
        setDropTarget(null);
      }
    },
    drop(event) {
      if (!draggingKey.value) return;
      event.preventDefault();
      commitDrop();
    },
    dragend() {
      // 드롭 없이 취소돼도(ESC 등) 소스에서 반드시 발생하므로 여기서 정리한다.
      cancelDrag();
    },
  };

  return reactive({
    order,
    weights,
    boundaries,
    gridStyle,
    panelProps,
    containerHandlers,
    draggingKey,
    dropTargetKey,
    resizingBoundary,
    panelKeyAtPoint,
    beginDrag,
    setDropTarget,
    commitDrop,
    cancelDrag,
    beginResize,
    nudgeResize,
    resetToDefault,
    resetWidths,
  });
}
