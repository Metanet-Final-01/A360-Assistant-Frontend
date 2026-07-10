import { computed, reactive, ref } from "vue";

// 로그아웃 시 초기화해야 하는 저장 키 — auth 스토어(logout)와 각 화면의
// usePanelReorder 호출부가 같은 문자열을 쓰도록 여기 한 곳에서만 정의한다.
export const ANALYSIS_PANEL_ORDER_KEY = "a360.panelOrder.analysis";
export const ARCHIVE_PANEL_ORDER_KEY = "a360.panelOrder.archive";

// 좌표 아래 있는 패널의 키를 찾는다. 네이티브 HTML5 드래그는 고스트 이미지가 히트테스트에
// 끼지 않아 event.target을 바로 써도 되지만, 포인터 이벤트로 움직이는 플로팅 챗봇 팝업은
// 커서 아래 실제로 자신이 깔려 있어 elementFromPoint가 그 팝업 자신을 잡아버린다 — 그래서
// 호출 전에 팝업의 pointer-events를 잠깐 꺼 두는 건 호출부(ChatWidget) 책임으로 둔다.
function panelKeyAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest?.("[data-panel-key]")?.dataset.panelKey ?? null;
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
export function usePanelReorder({ storageKey, defaultOrder, columnWidths, isVisible = () => true }) {
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

  const order = ref(readStored() ?? [...defaultOrder]);
  const draggingKey = ref(null);
  const dropTargetKey = ref(null);

  // 도킹 해제된 챗봇처럼 지금 그리드에 없는 패널은 열 계산에서 빼되,
  // order에는 남겨 둬서 다시 도킹하면 원래 자리로 돌아오게 한다.
  const gridStyle = computed(() => ({
    "--grid-cols": order.value
      .filter((key) => isVisible(key))
      .map((key) => columnWidths[key])
      .join(" "),
  }));

  // 각 패널(또는 컴포넌트 루트)에 v-bind로 뿌리는 속성 묶음.
  // ChatWidget처럼 루트가 display: contents여도 --panel-order가 자식 팝업까지
  // 상속되므로 동일하게 쓸 수 있다.
  function panelProps(key) {
    return {
      "data-panel-key": key,
      style: { "--panel-order": String(order.value.indexOf(key)) },
      class: {
        "panel-reorder-source": draggingKey.value === key,
        "panel-reorder-target": dropTargetKey.value === key && draggingKey.value !== key,
      },
    };
  }

  // .chat-widget 래퍼는 display: contents라 박스가 없어서, 고스트 이미지는
  // 실제로 그려지는 자식(도킹된 팝업)으로 잡는다.
  function boxElOf(panelEl) {
    if (panelEl.getClientRects().length) return panelEl;
    return Array.from(panelEl.children).find((child) => child.getClientRects().length) ?? panelEl;
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
  // 곳에서도 쓰이므로, localStorage만 지워서는 부족하고 메모리상 order도 같이 되돌려야 한다.
  function resetToDefault() {
    order.value = [...defaultOrder];
    localStorage.removeItem(storageKey);
    cancelDrag();
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
    gridStyle,
    panelProps,
    containerHandlers,
    draggingKey,
    dropTargetKey,
    panelKeyAtPoint,
    beginDrag,
    setDropTarget,
    commitDrop,
    cancelDrag,
    resetToDefault,
  });
}
