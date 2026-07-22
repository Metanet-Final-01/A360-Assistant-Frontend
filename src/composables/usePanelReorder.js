import { computed, reactive, ref } from "vue";

// 로그아웃 시 초기화해야 하는 저장 키 — auth 스토어(logout)와 App.vue의
// usePanelReorder 호출부가 같은 문자열을 쓰도록 여기 한 곳에서만 정의한다.
export const ANALYSIS_PANEL_ORDER_KEY = "a360.panelOrder.analysis";

// 핸들 하나가 차지하는 트랙 폭 — 기존 그리드 gap(24px)을 그대로 대체해, 리사이즈 핸들이
// 생겨도 패널 사이 간격이 지금과 똑같이 보이게 한다(핸들이 그 24px 안에서 그려짐).
export const PANEL_GAP_PX = 24;

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

// Vue TransitionGroup의 슬라이드 애니메이션(App.vue의 name="panel-move")이 진행 중인
// 요소는 getBoundingClientRect()가 아직 최종 위치가 아니라 애니메이션 도중의(transform이
// 걸린) 시각적 좌표를 돌려준다. 드래그 중 스왑 판정은 항상 "최종적으로 자리 잡을" 논리적
// 위치를 기준으로 해야 한다 — 그렇지 않으면 방금 스왑한 패널을 곧바로 다시 측정할 때
// 아직 애니메이션 중인 좌표를 읽어 엉뚱하게 판정한다(예: 화면 밖으로 밀리는 문제).
// Vue의 move 트랜지션은 인라인 style.transform이 아니라 CSS transition으로 값을
// 보간하므로, 지금 실제로 그려지는 transform은 getComputedStyle에서만 읽힌다 — 그
// matrix의 이동량(순수 translate만 쓰므로 tx,ty)만큼을 되돌려 보정한다.
function layoutRect(el) {
  const rect = el.getBoundingClientRect();
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return rect;
  // DOMMatrixReadOnly는 브라우저가 matrix(...)/matrix3d(...) 어느 쪽으로 직렬화하든
  // m41/m42(translateX/Y)를 동일하게 돌려준다(Qodo 리뷰) — 문자열을 직접 정규식으로
  // 파싱하면 3D 직렬화 환경에서 보정이 통째로 스킵된다.
  const dx = new DOMMatrixReadOnly(transform).m41;
  const dy = new DOMMatrixReadOnly(transform).m42;
  return {
    left: rect.left - dx,
    right: rect.right - dx,
    top: rect.top - dy,
    bottom: rect.bottom - dy,
    width: rect.width,
    height: rect.height,
  };
}

function layoutRectByKey(key) {
  const el = boxElByKey(key);
  return el ? layoutRect(el) : null;
}

// 고스트로 복제할 때 원본과 id/data-panel-key가 겹치면 안 된다 — id가 겹치면
// aria-labelledby 등이 엉뚱한(복제된) 요소를 가리키게 되고, data-panel-key가 겹치면
// boxElByKey()의 document.querySelector가 드래그 도중 고스트를(문서 순서상 먼저 걸리면)
// 실제 패널로 착각해 실측 좌표를 잘못 읽는다.
function stripIds(el) {
  if (el.nodeType !== 1) return;
  if (el.hasAttribute("id")) el.removeAttribute("id");
  if (el.hasAttribute("data-panel-key")) el.removeAttribute("data-panel-key");
  Array.from(el.children).forEach(stripIds);
}

// 페이지 그리드 안 패널(업로드/분석 결과/도킹된 챗봇 등)의 가로 배치를 드래그앤드롭으로
// 바꾸고 localStorage에 저장한다. 순서는 CSS order(--panel-order)와 그리드 열 폭
// (--grid-cols)으로만 반영하므로 DOM 구조는 그대로다.
//
// 드래그 시작은 각 패널 헤더의 [data-panel-handle] 그립에서만 허용한다. 이렇게 하면
// 같은 화면에서 이미 네이티브 드래그를 쓰는 것들 — 분석 결과 카드(rec-card) 순서 변경,
// 업로드 드롭존의 파일 드래그 — 과 이벤트가 섞이지 않는다.
//
// 드래그 중에는 order를 그 자리에서 계속 갱신한다(실시간 미리보기) — 그래서 커밋은 그냥
// "지금 order를 저장", 취소는 "드래그 시작 시점 order로 되돌리기"일 뿐이다. 핸들 드래그
// (beginPanelDrag)와 플로팅 챗봇의 포인터 드래그(ChatWidget의 beginDrag) 둘 다 같은
// updateLiveOrder/finishDrag를 공유한다.
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
  const resizingBoundary = ref(null);

  const draggingKey = ref(null);
  // 드래그 중인 패널 자신의 화면 좌표를 따라가는 반투명 "고스트"(핸들로 집어 든 패널의
  // 스냅샷 복제본). 챗봇을 플로팅 상태에서 도킹 존으로 끌 때는 팝업 자신이 이미 반투명
  // 유령 역할을 하므로 별도 고스트가 필요 없어 null로 둔다.
  const dragGhost = ref(null); // { html, grabX, grabY, width, height }
  const dragPointer = ref(null); // { x, y } — 뷰포트 기준 현재 커서 위치
  // 드래그 중인 키가 드래그 시작 전에 실제로(도킹 등으로) 보이는 상태였는지 — 보이던
  // 패널을 집으면 그 자리를 폭은 유지한 채 내용만 비우고(panel-reorder-dragging), 숨어
  // 있던(도킹 해제된 챗봇) 패널을 도킹 존 위로 끌고 오면 dragPreviewVisible이 true인
  // 동안만 같은 방식으로 자리를 새로 만든다.
  const dragOriginallyVisible = ref(false);
  const dragPreviewVisible = ref(false);
  let dragOrderSnapshot = null;
  // updateLiveOrder에서 매 픽셀 pointermove마다 재계산하지 않도록 손 떨림 정도의 이동은
  // 건너뛰는 데 쓰는 마지막 처리 좌표 — 900px 이하 단일 컬럼(세로 스택)에서는 y좌표,
  // 그 외엔 x좌표를 담는다(updateLiveOrder가 매 호출마다 축을 골라 같은 변수를 쓴다).
  let lastPointerPos = null;
  // 폭이 많이 다른 패널끼리 스왑하면 경계가 커서보다 훨씬 멀리 "점프"한다 — 예를 들어
  // 좁은 패널이 넓은 패널을 지나쳐 그 뒤로 넘어가면, 넓은 패널이 이제 반대쪽 이웃이
  // 되면서 같은 커서 좌표가 "반대 방향으로도 스왑해야 한다"는 기하학적 조건을 동시에
  // 만족해버려 곧바로 되돌아가는 흔들림이 생긴다. 그래서 마지막 스왑이 일어난 좌표·방향을
  // 기억해 두고, 반대 방향 스왑은 커서가 그 좌표에서 실제로 충분히(HYSTERESIS_PX) 되돌아
  // 나왔을 때만 허용한다.
  let lastSwapPointerPos = null;
  let lastSwapDirection = 0; // 0=아직 없음, 1=정방향(오른쪽/아래) 이웃과 스왑, -1=역방향(왼쪽/위) 이웃과 스왑

  // 도킹 해제된 챗봇처럼 지금 그리드에 안 보이는 패널도 트랙 자체는 항상 남겨 두고
  // (minmax(0px,0fr)로 접어서) 폭만 0으로 만든다 — 트랙 개수·구성이 보이기/숨기기 상태와
  // 무관하게 항상 같아야, 도킹 해제/복귀 때 grid-template-columns가 값만 부드럽게
  // 전환되고(브라우저가 같은 모양의 트랙 리스트만 보간한다) 나머지 패널이 그 자리를
  // 애니메이션으로 채워 들어간다. 숨은 패널과 맞닿은 핸들도 둘 중 하나만 접어(0px)
  // 보이는 패널 사이엔 정확히 하나의 정상 간격만 남긴다.
  //
  // 드래그 중인 패널은 실제 isVisible과 별개로, "지금 order상 이 자리에 놓이면 이렇게 된다"를
  // 보여주기 위해 항상 정상 폭의 트랙을 유지한다(0으로 접지 않는다) — 원래 보이던 패널을
  // 집어 들면(핸들 드래그) 원래 자리가 통째로 사라지는 대신 내용만 비워진 채(panelProps의
  // panel-reorder-dragging 클래스) 자기 폭을 유지하고, 원래 숨어 있던 패널을 도킹 존 위로
  // 끌고 오면(플로팅 챗봇) dragPreviewVisible인 동안만 같은 방식으로 자리를 새로 만든다.
  // 폭 자체를 0으로 접어버리면 커서를 따라다니는 고스트만 남고 정작 "여기 놓인다"는 자리는
  // 화면 어디에도 안 남아, 다른 패널 위에 고스트가 그냥 겹쳐 보이는 문제가 있었다.
  function effectiveVisible(key) {
    if (draggingKey.value === key) {
      return dragOriginallyVisible.value || dragPreviewVisible.value;
    }
    return isVisible(key);
  }

  const layout = computed(() => {
    const keys = order.value;
    const tracks = [];
    const boundaries = [];
    const collapsedFor = new Set();
    keys.forEach((key, i) => {
      const visible = effectiveVisible(key);
      tracks.push(visible ? `minmax(${minWidths[key]}px, ${weights.value[key]}fr)` : "minmax(0px, 0fr)");
      if (i === keys.length - 1) return;
      const leftKey = key;
      const rightKey = keys[i + 1];
      const leftHidden = !visible;
      const rightHidden = !effectiveVisible(rightKey);
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
        // 어느 두 패널 사이인지(leftKey::rightKey)가 아니라, 그 사이 "칸" 자체의 고정
        // 슬롯 번호를 key로 쓴다 — leftKey::rightKey를 키로 쓰면 순서가 바뀔 때마다 거의
        // 매번 다른 문자열이 되어(예: "upload::analysis" → "analysis::upload") Vue가
        // TransitionGroup에서 이 요소들을 "이동"이 아니라 "제거 후 새로 추가"로 취급한다.
        // 그러면 사라지는 옛 핸들과 새로 생기는 핸들이 잠깐 동시에 존재하면서 같은
        // order 값을 가진 그리드 아이템이 두 개가 되고, CSS Grid의 자동 배치가 완전히
        // 틀어져 패널이 엉뚱한 칸(심하면 다음 줄)으로 밀려나는 원인이 됐다.
        key: `boundary-${i}`,
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

  const dragGhostStyle = computed(() => {
    if (!dragGhost.value || !dragPointer.value) return null;
    return {
      left: `${dragPointer.value.x - dragGhost.value.grabX}px`,
      top: `${dragPointer.value.y - dragGhost.value.grabY}px`,
      width: `${dragGhost.value.width}px`,
      height: `${dragGhost.value.height}px`,
    };
  });

  // 각 패널(또는 컴포넌트 루트)에 v-bind로 뿌리는 속성 묶음.
  // ChatWidget처럼 루트가 display: contents여도 --panel-order가 자식 팝업까지
  // 상속되므로 동일하게 쓸 수 있다.
  function panelProps(key) {
    const idx = order.value.indexOf(key);
    return {
      "data-panel-key": key,
      style: { "--panel-order": String(idx === -1 ? 0 : idx * 2) },
      class: {
        // 핸들로 집어 든 패널 자신 — 폭은 그대로 유지한 채(effectiveVisible) 내용만
        // 비워서 "여기 있던 자리가 곧 놓일 자리"임을 보여준다. 실제 시각적 유령은
        // 커서를 따라다니는 별도 고스트(.panel-drag-ghost)가 맡는다.
        "panel-reorder-dragging": draggingKey.value === key && dragOriginallyVisible.value,
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

  // 손이 미세하게 떨리는 정도의 이동은 재계산 자체를 건너뛴다 — 매 픽셀 pointermove마다
  // 다시 계산하면 이미 정착한 위치 근처에서도 계속 애니메이션이 다시 트리거된다.
  const MIN_MOVE_PX = 6;
  // 드래그 중인 패널의 빈 자리와 바로 옆 이웃 사이 경계(간격 한가운데)를 이만큼은 확실히
  // 넘어야 자리를 맞바꾼다 — 그렇지 않으면 경계선 바로 위에서 커서가 살짝만 흔들려도
  // 순서가 계속 앞뒤로 뒤집힌다.
  const HYSTERESIS_PX = 28;

  // order상 fromIdx에서 direction(±1) 방향으로 가장 가까운 "보이는" 키를 찾는다 —
  // 도킹 해제된 챗봇처럼 숨어 있는 자리는 건너뛴다.
  function findAdjacentVisible(keys, fromIdx, direction) {
    for (let i = fromIdx + direction; i >= 0 && i < keys.length; i += direction) {
      if (isVisible(keys[i])) return keys[i];
    }
    return null;
  }

  function swapKeys(keyA, keyB) {
    const next = [...order.value];
    const idxA = next.indexOf(keyA);
    const idxB = next.indexOf(keyB);
    if (idxA === -1 || idxB === -1) return;
    [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
    order.value = next;
  }

  // 900px 이하에서는 그리드가 단일 컬럼(세로 스택)으로 바뀐다(style.css) — 그 상태에서
  // 커서의 x좌표로 스왑을 판정하면 좁은 화면에서 재배치가 거의 동작하지 않거나 엉뚱한
  // 스왑이 일어난다(Qodo 리뷰). 레이아웃 축(가로/세로)에 맞는 좌표·경계를 골라 쓴다.
  const stackedLayoutMql = window.matchMedia("(max-width: 900px)");

  // 커서 좌표(가로 배치면 x, 세로 스택이면 y)를 기준으로, 드래그 중인 패널의 "빈 자리"와
  // 바로 옆 이웃 사이의 경계선을 넘었는지만 본다 — 넓은 패널이라도 그 패널의 중심까지 갈
  // 필요 없이, 옆 패널과 맞닿는 경계선만 넘으면 즉시 그 이웃과 자리를 맞바꾼다. 한 번에
  // 여러 칸을 건너뛰는 빠른 이동은, 매 pointermove마다 이 함수가 다시 불리면서 자연스럽게
  // 연쇄적으로 이어진다(order.value가 바뀐 직후엔 DOM이 아직 리렌더되지 않아 같은 호출
  // 안에서 두 칸을 한꺼번에 확정할 수 없으므로, 한 번의 호출에서는 한 칸만 옮긴다).
  function updateLiveOrder(pointerX, pointerY) {
    const dragged = draggingKey.value;
    if (!dragged) return;
    const stacked = stackedLayoutMql.matches;
    const pointerPos = stacked ? pointerY : pointerX;
    if (pointerPos == null) return;
    if (lastPointerPos != null && Math.abs(pointerPos - lastPointerPos) < MIN_MOVE_PX) return;
    lastPointerPos = pointerPos;

    const current = order.value;
    const draggedIdx = current.indexOf(dragged);
    if (draggedIdx === -1) return;
    const draggedRect = layoutRectByKey(dragged);
    if (!draggedRect) return;

    const forwardKey = findAdjacentVisible(current, draggedIdx, 1);
    if (forwardKey) {
      const forwardRect = layoutRectByKey(forwardKey);
      // 직전 스왑이 반대 방향이었다면, 커서가 그때 좌표에서 실제로 정방향으로 충분히
      // 되돌아 나왔을 때만 다시 스왑한다 — 그렇지 않으면 폭/높이 차이가 큰 패널과
      // 스왑한 직후 같은 좌표에서 곧바로 되돌아가는 흔들림이 생긴다.
      const directionOk =
        lastSwapDirection >= 0 || lastSwapPointerPos == null || pointerPos >= lastSwapPointerPos + HYSTERESIS_PX;
      if (forwardRect && directionOk) {
        const boundary = stacked
          ? (draggedRect.bottom + forwardRect.top) / 2
          : (draggedRect.right + forwardRect.left) / 2;
        if (pointerPos >= boundary + HYSTERESIS_PX / 2) {
          swapKeys(dragged, forwardKey);
          lastSwapPointerPos = pointerPos;
          lastSwapDirection = 1;
          return;
        }
      }
    }

    const backwardKey = findAdjacentVisible(current, draggedIdx, -1);
    if (backwardKey) {
      const backwardRect = layoutRectByKey(backwardKey);
      const directionOk =
        lastSwapDirection <= 0 || lastSwapPointerPos == null || pointerPos <= lastSwapPointerPos - HYSTERESIS_PX;
      if (backwardRect && directionOk) {
        const boundary = stacked
          ? (draggedRect.top + backwardRect.bottom) / 2
          : (draggedRect.left + backwardRect.right) / 2;
        if (pointerPos <= boundary - HYSTERESIS_PX / 2) {
          swapKeys(backwardKey, dragged);
          lastSwapPointerPos = pointerPos;
          lastSwapDirection = -1;
        }
      }
    }
  }

  function resetDragHysteresis() {
    lastPointerPos = null;
    lastSwapPointerPos = null;
    lastSwapDirection = 0;
  }

  // 챗봇처럼 원래 숨어 있던(도킹 해제된) 키를 도킹 존 위로 끌고 왔는지 여부 —
  // true인 동안만 그 키의 트랙을 임시로 펼쳐서 "여기 놓으면 이렇게 된다"를 미리 보여준다.
  // 존을 벗어나면 즉시 드래그 시작 시점 순서로 되돌린다(아직 놓은 게 아니므로).
  function setDragPreviewVisible(visible) {
    if (dragPreviewVisible.value === visible) return;
    dragPreviewVisible.value = visible;
    if (!visible && dragOrderSnapshot) {
      order.value = [...dragOrderSnapshot];
      // 존을 벗어나 순서를 되돌렸으니, 다시 들어왔을 때의 첫 판정이 존을 나가기 전
      // 위치에 끌려가지 않게 흔들림 방지 기준도 같이 초기화한다.
      resetDragHysteresis();
    }
  }

  // 핸들(그립)로 원래 보이던 패널을 집어 든 경우 전용 — 커서를 따라다니는 반투명
  // 고스트(스냅샷 복제본)를 만들고, 원본 자리는 폭을 유지한 채 내용만 비워(effectiveVisible +
  // panel-reorder-dragging) 빈 슬롯으로 보여준다. 플로팅 챗봇을 도킹 존으로 끄는 경우는
  // ChatWidget이 자기 팝업을 이미 반투명 유령으로 쓰므로 beginDrag(key)만 직접 호출한다.
  function beginPanelDrag(key, pointerX, pointerY, panelEl) {
    if (draggingKey.value) return;
    const boxEl = boxElOf(panelEl);
    const rect = boxEl.getBoundingClientRect();
    const clone = boxEl.cloneNode(true);
    stripIds(clone);
    clone.removeAttribute("style");
    // 루트의 실제 클래스(.panel, .chat-popup--docked 등)를 그대로 두면 고스트가 원본과
    // 똑같은 class="chat-popup--docked" 등을 문서에 하나 더 만들어, 그 클래스를 겨냥한
    // 선택자(예: panel-reorder-dragging의 자식 결합자)가 고스트에도 걸리거나 클래스 기반
    // 조회가 두 개를 다 잡을 수 있다 — 시각 스타일은 .panel-drag-ghost가 전담하므로 지운다.
    clone.removeAttribute("class");
    dragGhost.value = {
      html: clone.outerHTML,
      grabX: pointerX - rect.left,
      grabY: pointerY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    dragPointer.value = { x: pointerX, y: pointerY };
    dragOrderSnapshot = [...order.value];
    dragOriginallyVisible.value = isVisible(key);
    dragPreviewVisible.value = true;
    draggingKey.value = key;
    resetDragHysteresis();
    window.addEventListener("pointermove", onPanelDragMove);
    window.addEventListener("pointerup", onPanelDragEnd);
    window.addEventListener("pointercancel", onPanelDragCancel);
  }

  function onPanelDragMove(event) {
    dragPointer.value = { x: event.clientX, y: event.clientY };
    updateLiveOrder(event.clientX, event.clientY);
  }

  function removePanelDragListeners() {
    window.removeEventListener("pointermove", onPanelDragMove);
    window.removeEventListener("pointerup", onPanelDragEnd);
    window.removeEventListener("pointercancel", onPanelDragCancel);
  }

  function onPanelDragEnd() {
    removePanelDragListeners();
    finishDrag(true);
  }

  function onPanelDragCancel() {
    removePanelDragListeners();
    finishDrag(false);
  }

  // 그리드 컨테이너에서 포인터다운을 위임받아, [data-panel-handle] 그립 위에서 시작된
  // 경우에만 반응한다 — 이렇게 하면 같은 화면의 다른 네이티브 드래그(파일 업로드
  // 드롭존, 분석 결과 카드 순서 변경)와 이벤트가 섞이지 않는다.
  function handleGridPointerDown(event) {
    // 마우스 좌클릭(또는 터치/펜의 주 포인터)만 드래그를 시작한다(Qodo 리뷰) — 그렇지
    // 않으면 우클릭 컨텍스트 메뉴나 보조 버튼 클릭에서도 재배치가 시작돼 버린다.
    if (event.button !== 0 || !event.isPrimary) return;
    const handle = event.target.closest?.("[data-panel-handle]");
    if (!handle) return;
    const panelEl = handle.closest("[data-panel-key]");
    if (!panelEl) return;
    event.preventDefault();
    beginPanelDrag(panelEl.dataset.panelKey, event.clientX, event.clientY, panelEl);
  }

  // 플로팅 챗봇 전용 진입점 — ChatWidget이 자기 팝업을 이미 반투명 유령으로 쓰므로
  // 별도 고스트 없이 order 실시간 갱신에만 참여한다.
  function beginDrag(key) {
    if (draggingKey.value) return;
    dragOrderSnapshot = [...order.value];
    dragOriginallyVisible.value = isVisible(key);
    dragPreviewVisible.value = false;
    dragGhost.value = null;
    dragPointer.value = null;
    draggingKey.value = key;
    resetDragHysteresis();
  }

  function finishDrag(commit) {
    if (!draggingKey.value) return;
    // 로그아웃(resetToDefault) 등 외부에서 드래그 도중 곧장 finishDrag/cancelDrag를 부르는
    // 경우에도 beginPanelDrag가 window에 걸어 둔 리스너가 남지 않게 항상 같이 정리한다
    // (이미 정상적으로 끝난 드래그라면 리스너가 없으므로 그냥 no-op).
    removePanelDragListeners();
    if (commit) {
      localStorage.setItem(storageKey, JSON.stringify(order.value));
    } else if (dragOrderSnapshot) {
      order.value = [...dragOrderSnapshot];
    }
    draggingKey.value = null;
    dragGhost.value = null;
    dragPointer.value = null;
    dragOriginallyVisible.value = false;
    dragPreviewVisible.value = false;
    dragOrderSnapshot = null;
    resetDragHysteresis();
  }

  function cancelDrag() {
    finishDrag(false);
  }

  // 로그아웃 시 호출 — 이 컴포저블은 App.vue 루트처럼 로그인 세션을 넘나들며 살아있는
  // 곳에서도 쓰이므로, localStorage만 지워서는 부족하고 메모리상 order/weights도 같이 되돌려야 한다.
  function resetToDefault() {
    cancelDrag();
    order.value = [...defaultOrder];
    localStorage.removeItem(storageKey);
    resetWidths();
  }

  return reactive({
    order,
    weights,
    boundaries,
    gridStyle,
    panelProps,
    draggingKey,
    dragGhost,
    dragGhostStyle,
    dragPointer,
    resizingBoundary,
    handleGridPointerDown,
    beginDrag,
    updateLiveOrder,
    setDragPreviewVisible,
    finishDrag,
    cancelDrag,
    beginResize,
    nudgeResize,
    resetToDefault,
    resetWidths,
  });
}
