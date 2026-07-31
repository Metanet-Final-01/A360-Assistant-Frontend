<script setup>
// 추천 작업 흐름도 모달의 인터랙티브 캔버스 — Vue Flow로 확대/축소·팬, 카탈로그에서 골라
// 액션을 바꿔치기·삭제, 드래그앤드롭 재정렬(컨테이너 무결성 유지)을 제공한다. 소스 오브
// 트루스는 항상 로컬 편집 버퍼(editableTree)고, 화면(nodes/edges)은 매번 그 트리로부터
// buildFlowGraph로 다시 계산한다 — 드롭이 무효면 다음 렌더에서 트리 기준 위치로 자연히
// 스냅백된다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { VueFlow, useVueFlow, getRectOfNodes, getTransformForBounds } from "@vue-flow/core";
import { Controls } from "@vue-flow/controls";
import { Background } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

import ActionNode from "./ActionNode.vue";
import ContainerNode from "./ContainerNode.vue";
import BranchSetNode from "./BranchSetNode.vue";
import BranchColumnNode from "./BranchColumnNode.vue";
import LabelNode from "./LabelNode.vue";

import { buildFlowGraph, buildFlowGraphPages, LAYOUT, Z_FLOATING } from "../../utils/flowLayout";
import {
  assignUiIds,
  stripUiIds,
  stripEmptyChildren,
  getAt,
  insertAt,
  removeAt,
  isSelfOrDescendant,
  moveSegment,
  childListPath,
} from "../../utils/flowTree";
import { collectDropLists, buildDropAnchors, nearestAnchor } from "../../utils/flowDrop";
import { ACTION_CATALOG_MIME, createActionNode } from "../../utils/actionCatalog";

const props = defineProps({
  steps: { type: Array, default: () => [] },
  editable: { type: Boolean, default: true },
});

// dirty/saving은 부모(flow-window의 FlowWindowApp)의 저장 버튼이 반응형으로 읽어야 하므로 exposed ref
// 대신 이벤트로 내보낸다 — 템플릿 ref를 통한 중첩 ref 언래핑에 기대지 않는 게 더 안전하다.
const emit = defineEmits(["update:dirty", "update:saving", "update:unplaced-count"]);
const { t } = useI18n();

// 백엔드가 내려준 steps를 로컬 편집 버퍼로 복제한다 — 딥카피 직후 stripEmptyChildren으로
// 리프 액션의 빈 children[](백엔드 스키마 기본값)을 지운다(자세한 이유는 flowTree.js 참고).
function cloneTree(steps) {
  return stripEmptyChildren(JSON.parse(JSON.stringify(steps ?? [])));
}

const editableTree = ref(assignUiIds(cloneTree(props.steps)));
const dirty = ref(false);
const saving = ref(false);
const pendingSummaries = ref([]);

// 패키지/액션 피커에서 클릭·드롭으로 만들었지만 아직 트리 어디에도 편입되지 않은 "미배치" 카드들 —
// 캔버스 여백에 자유롭게 떠 있다가, 사용자가 흐름도 위로 끌어다 놓으면 그 위치에서 트리로 편입된다
// (unplacedDragCtx). { node: RecommendedAction(+__uid), position: {x,y} }[].
const unplacedNodes = ref([]);

watch(dirty, (v) => emit("update:dirty", v));
watch(saving, (v) => emit("update:saving", v));
// Vue는 커스텀 emit 이름을 kebab-case로 자동 변환해 주지 않는다(props와 다름) — 템플릿의
// @update:unplaced-count 리스너와 정확히 같은 문자열이어야 실제로 연결된다.
watch(
  () => unplacedNodes.value.length,
  (n) => emit("update:unplaced-count", n),
  { immediate: true },
);

// 외부(버전 되돌리기 등)에서 steps가 바뀌면 그게 새 정답이다 — 저장 안 한 로컬 편집(dirty)이나
// 미배치 카드가 있어도 무시하고 무조건 새 steps로 다시 맞춘다. 예전엔 dirty면 건너뛰어서, 되돌리기
// 직후 "저장"을 누르면 낡은 로컬 편집이 방금 되돌린 버전을 덮어써 버리는 문제가 있었다.
watch(
  () => props.steps,
  (next) => {
    editableTree.value = assignUiIds(cloneTree(next));
    unplacedNodes.value = [];
    dirty.value = false;
    pendingSummaries.value = [];
  },
);

// 카탈로그에서 고른 새 액션으로 target을 통째로 바꿔치기한다. children은 상황에 따라 다르게
// 다룬다 — flowLayout/flowDrop은 children.length가 아니라 Array.isArray(children)로 컨테이너
// 여부를 판단하므로: 이미 컨테이너였던 노드(children이 배열)를 다른 컨테이너 종류로 바꾸면
// 기존 하위 액션을 그대로 보존하고, 리프를 컨테이너로 바꾸면 새로 빈 children[]을 만들어야
// 컨테이너 프레임으로 렌더되고 드롭도 받을 수 있다. 반대로 컨테이너를 리프로 바꾸면 children을
// 지워야 옛 하위 액션이 유령처럼 남아 계속 컨테이너로 렌더되는 걸 막는다.
// 컨테이너 → 리프로 바꾸면 children을 지워야 하는데(Qodo 리뷰), 그 안에 이미 하위 액션이
// 있으면 트리 전체가 조용히 사라진다 — 삭제(deleteActionConfirm)와 같은 수준의 파괴적 동작이라
// 동일하게 window.confirm으로 사용자 확인을 받은 뒤에만 진행한다. 취소하면 아무것도 바꾸지 않는다.
// 취소되면 false를 반환한다 — 호출부가 markDirty/rebuildNodes 같은 후속 처리를 건너뛰게 하기 위함.
function applyActionChange(target, descriptor) {
  const { children: newChildren, ...patch } = createActionNode(descriptor);
  if (newChildren === undefined && Array.isArray(target.children) && target.children.length > 0) {
    if (!window.confirm(t("recommendFlow.changeActionChildrenConfirm"))) return false;
  }
  Object.assign(target, patch);
  if (newChildren !== undefined) {
    if (!Array.isArray(target.children)) target.children = [];
  } else {
    delete target.children;
  }
  return true;
}

function markDirty(summaryKey) {
  dirty.value = true;
  if (!pendingSummaries.value.includes(summaryKey)) pendingSummaries.value.push(summaryKey);
}

// DOCX 다중 페이지 내보내기가 캡처하는 동안만 채워지는 페이지 배열 — null이면 평소처럼
// buildFlowGraph(세로 한 줄, 편집 가능)를 그린다. 값이 있으면 exportPageIndex번째 페이지 조각
// (buildFlowGraphPages, RPA-296 후속)만 그린다. 자세한 이유는 flowLayout.js의
// buildFlowGraphPages 주석 참고 — 백엔드가 이미지를 고정 폭으로만 삽입하고, Word는 페이지보다
// 큰 인라인 그림을 다음 페이지로 이어주지 않고 그냥 잘라버려서, 스텝 경계에서 여러 장으로
// 나눠 캡처한 뒤 백엔드가 장마다 페이지 나눔을 넣어 삽입한다.
const exportPages = ref(null);
const exportPageIndex = ref(0);
const graph = computed(() => exportPages.value?.[exportPageIndex.value] ?? buildFlowGraph(editableTree.value));

function enrich(node) {
  // node.draggable은 flowLayout이 세그먼트 루트(action/container/branchSet)에만 true로 표시해 둔
  // 값이다 — editable이 false면 그 true들도 전부 꺼서 실제로 드래그가 시작되지 않게 한다.
  // (branchColumn/label처럼 원래 false인 건 그대로 false.)
  const draggable = node.draggable ? props.editable : node.draggable;
  if (!node.data?.nodePath) return { ...node, draggable };
  const nodePath = node.data.nodePath;
  return {
    ...node,
    draggable,
    data: {
      ...node.data,
      editable: props.editable,
      // 라벨을 자유 텍스트로 고치는 대신 항상 카탈로그에서 다른 패키지/액션을 골라 통째로
      // 바꿔치기한다 — createActionNode가 package/action/label/parameters/confidence/rationale/
      // sources를 새 값으로 리셋해 주므로, 옛 액션의 신뢰도·근거처럼 새 선택과 무관해진 값이
      // 남아 헷갈리지 않는다. __uid는 그대로 보존한다. children은 applyActionChange가 상황에
      // 맞게(보존/신설/제거) 처리한다.
      onChangeAction: (descriptor) => {
        const target = getAt(editableTree.value, nodePath);
        if (target && applyActionChange(target, descriptor)) {
          markDirty("changeAction");
        }
      },
      onDelete: () => {
        removeAt(editableTree.value, nodePath);
        markDirty("deleteAction");
      },
    },
  };
}

// 미배치 카드(unplacedNodes)는 그때그때 사용자가 끌어다 놓은 화면 좌표(position)를 그대로
// 들고 있다가, 트리 편집으로 인한 전체 재계산(watch(graph, ...))·editable 토글이 일어날 때마다
// 함께 다시 그려 넣는다 — 그러지 않으면 트리 쪽 노드만 다시 계산되면서 여백의 카드가 사라진다.
const UNPLACED_TAG_COLOR = "#8a94a3";

function toFloatingFlowNode(entry) {
  const node = entry.node;
  return {
    id: node.__uid,
    type: "action",
    position: entry.position,
    width: LAYOUT.NODE_W,
    height: LAYOUT.NODE_H,
    draggable: props.editable,
    zIndex: Z_FLOATING,
    data: {
      label: node.label || node.action,
      prefix: "",
      pkg: node.package,
      color: UNPLACED_TAG_COLOR,
      isContainer: false,
      confidence: null,
      rationale: null,
      sources: [],
      editable: props.editable,
      unplaced: true,
      // 이 카드의 data.label/pkg 등은 toFloatingFlowNode 호출 시점의 스냅샷이라, entry.node를
      // 고쳐도 rebuildNodes()로 다시 그려 넣기 전까지는 화면에 반영되지 않는다 — 트리 노드와
      // 달리 graph computed에 안 걸려 있어 자동으로 갱신되지 않기 때문.
      onChangeAction: (descriptor) => {
        const idx = unplacedNodes.value.findIndex((e) => e.node.__uid === node.__uid);
        if (idx === -1) return;
        if (applyActionChange(unplacedNodes.value[idx].node, descriptor)) rebuildNodes();
      },
      onDelete: () => {
        unplacedNodes.value = unplacedNodes.value.filter((e) => e.node.__uid !== node.__uid);
        rebuildNodes();
      },
    },
  };
}

const nodes = ref([]);
const edges = ref([]);

function rebuildNodes() {
  nodes.value = [...graph.value.nodes.map(enrich), ...unplacedNodes.value.map(toFloatingFlowNode)];
}

watch(
  graph,
  (g) => {
    rebuildNodes();
    edges.value = g.edges;
  },
  { immediate: true },
);

// editable은 트리와 무관하게(편집 모드 토글) 바뀌므로 graph의 watch만으로는 이미 렌더된
// 노드들의 draggable/onCommit이 갱신되지 않는다 — 별도로 다시 적용한다.
watch(() => props.editable, rebuildNodes);

// 처음 열었을 때 전체 흐름도를 한 화면에 욱여넣으면(기본 fitView 동작) 글씨가 너무 작아진다 —
// "시작"이 캔버스 상단 가까이 보이는 100% 줌으로 시작하고, 나머지는 팬/스크롤로 보게 한다.
// fitView(nodes 서브셋 + padding)로는 대칭 패딩 때문에 "시작"이 항상 화면 중앙에 오게 돼서,
// 대신 setCenter로 "시작 필 중심에서 화면 절반 - 여백만큼 아래"인 지점을 화면 중앙에 맞춘다
// (그러면 시작 필 자체는 화면 상단 여백(topMargin)에 위치하게 된다).
const canvasRootRef = ref(null);
const { setCenter, onNodesInitialized, getViewport, setViewport, getNodes, screenToFlowCoordinate } = useVueFlow();
let didInitialFit = false;
onNodesInitialized(() => {
  if (didInitialFit || !nodes.value.length) return;
  const startNode = nodes.value.find((n) => n.id === "__start");
  const paneEl = canvasRootRef.value?.querySelector(".vue-flow__pane");
  if (!startNode || !paneEl) return;
  didInitialFit = true;
  const zoom = 1;
  const topMargin = 60;
  const paneHeight = paneEl.getBoundingClientRect().height;
  const startCenterX = startNode.position.x + (startNode.width ?? 0) / 2;
  const startCenterY = startNode.position.y + (startNode.height ?? 0) / 2;
  const targetY = startCenterY + (paneHeight / 2 - topMargin) / zoom;
  setCenter(startCenterX, targetY, { zoom, duration: 0 });
});

// 모달 최대화처럼 캔버스 컨테이너 크기가 바뀌면, 팬/줌은 그대로인데 컨테이너만 넓어져
// 콘텐츠가 화면 왼쪽/위로 쏠려 보인다 — 크기 변화분의 절반만큼 팬을 보정해 화면상
// 중심을 그대로 유지한다.
let lastCanvasSize = null;
function handleCanvasResize(entries) {
  const { width, height } = entries[0].contentRect;
  if (lastCanvasSize && didInitialFit) {
    const dx = (width - lastCanvasSize.width) / 2;
    const dy = (height - lastCanvasSize.height) / 2;
    if (dx || dy) {
      const vp = getViewport();
      setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
    }
  }
  lastCanvasSize = { width, height };
}

let canvasResizeObserver = null;
onMounted(() => {
  if (!canvasRootRef.value) return;
  canvasResizeObserver = new ResizeObserver(handleCanvasResize);
  canvasResizeObserver.observe(canvasRootRef.value);
});
onBeforeUnmount(() => {
  canvasResizeObserver?.disconnect();
});

// ----- 드래그 재정렬 / 미배치 카드 배치 -----
const dropHighlight = ref(null); // { refId, side } | null
let dragCtx = null; // 이미 트리에 속한 세그먼트를 재정렬할 때
let unplacedDragCtx = null; // 미배치 카드를 캔버스 위로 옮길 때

// 미배치 카드를 흐름도 위 "여기에 놓입니다" 앵커에 붙일지 판단하는 거리 상한(플로우 좌표계) —
// 카드를 흐름과 전혀 무관한 빈 공간에 내려놔도 항상 가장 가까운 앵커에 억지로 스냅되는 걸 막는다.
const UNPLACED_DROP_RADIUS = 140;

function nearestAnchorWithin(anchors, point, maxDist) {
  const best = nearestAnchor(anchors, point);
  if (!best) return null;
  return Math.hypot(best.x - point.x, best.y - point.y) <= maxDist ? best : null;
}

function boxOf(id) {
  const n = nodes.value.find((x) => x.id === id);
  if (!n) return null;
  const w = n.width ?? 0;
  const h = n.height ?? 0;
  return { cx: n.position.x + w / 2, cy: n.position.y + h / 2, top: n.position.y, bottom: n.position.y + h };
}

// 드래그 중인 세그먼트의 nodePath 범위 안에 속한(=함께 움직여야 하는) 다른 노드들 — branchSet을
// 잡으면 그 컬럼들과 컬럼의 자식들이 여기 해당한다(절대좌표로 따로 배치된 노드들이라 부모를
// 옮길 때 델타를 수동으로 같이 적용해야 한다).
function followerIds(rootNode) {
  const { listPath, startIndex, count } = rootNode.data.segment;
  return nodes.value
    .filter((n) => n.id !== rootNode.id && n.data?.nodePath)
    .filter((n) => {
      const np = n.data.nodePath;
      if (np.length < listPath.length + 1) return false;
      if (!listPath.every((seg, i) => np[i] === seg)) return false;
      const idx = np[listPath.length];
      return idx >= startIndex && idx < startIndex + count;
    })
    .map((n) => n.id);
}

function onNodeDragStart({ node }) {
  if (!props.editable) return;
  if (node.data?.unplaced) {
    unplacedDragCtx = {
      uid: node.id,
      anchors: buildDropAnchors(editableTree.value, collectDropLists(editableTree.value), boxOf),
      current: null,
    };
    return;
  }
  const segment = node.data?.segment;
  if (!segment) return;
  const excludedPrefixes = [];
  for (let i = 0; i < segment.count; i++) {
    excludedPrefixes.push(childListPath([...segment.listPath, segment.startIndex + i]));
  }
  const validLists = collectDropLists(editableTree.value).filter(
    (lp) => !excludedPrefixes.some((ex) => isSelfOrDescendant(ex, lp)),
  );
  const anchors = buildDropAnchors(editableTree.value, validLists, boxOf);
  const followers = followerIds(node).map((id) => {
    const n = nodes.value.find((x) => x.id === id);
    return { id, start: { ...n.position } };
  });
  dragCtx = { segment, anchors, rootId: node.id, rootStart: { ...node.position }, followers, current: null };
}

function onNodeDrag({ node }) {
  if (unplacedDragCtx && node.id === unplacedDragCtx.uid) {
    const w = node.width ?? node.dimensions?.width ?? 0;
    const h = node.height ?? node.dimensions?.height ?? 0;
    const center = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
    const best = nearestAnchorWithin(unplacedDragCtx.anchors, center, UNPLACED_DROP_RADIUS);
    unplacedDragCtx.current = best;
    dropHighlight.value = best ? { refId: best.refId, side: best.side } : null;
    return;
  }
  if (!dragCtx || node.id !== dragCtx.rootId) return;
  const dx = node.position.x - dragCtx.rootStart.x;
  const dy = node.position.y - dragCtx.rootStart.y;
  dragCtx.followers.forEach(({ id, start }) => {
    const n = nodes.value.find((x) => x.id === id);
    if (n) n.position = { x: start.x + dx, y: start.y + dy };
  });

  const w = node.width ?? node.dimensions?.width ?? 0;
  const h = node.height ?? node.dimensions?.height ?? 0;
  const center = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
  const best = nearestAnchor(dragCtx.anchors, center);
  dragCtx.current = best;
  dropHighlight.value = best ? { refId: best.refId, side: best.side } : null;
}

function onNodeDragStop({ node }) {
  if (unplacedDragCtx && node.id === unplacedDragCtx.uid) {
    const { current } = unplacedDragCtx;
    dropHighlight.value = null;
    unplacedDragCtx = null;
    const idx = unplacedNodes.value.findIndex((e) => e.node.__uid === node.id);
    if (idx === -1) return;
    if (current) {
      // 흐름도 위 유효한 위치에 놓였다 — 트리로 편입하고 미배치 목록에서 뺀다.
      const [entry] = unplacedNodes.value.splice(idx, 1);
      insertAt(editableTree.value, current.listPath, current.targetIndex, entry.node);
      assignUiIds(editableTree.value);
      markDirty("insertAction");
    } else {
      // 여전히 여백 — 스냅백하지 않고 사용자가 놓은 그 자리를 그대로 기억해 둔다.
      unplacedNodes.value[idx].position = { ...node.position };
    }
    return;
  }
  if (!dragCtx || node.id !== dragCtx.rootId) return;
  const { segment, current } = dragCtx;
  dropHighlight.value = null;
  dragCtx = null;
  if (current) {
    moveSegment(editableTree.value, segment, current.listPath, current.targetIndex);
    markDirty("reorder");
  } else {
    // 유효한 드롭 지점 없이 놓임 — 트리는 안 바뀌었으니 트리 기준 위치로 다시 그려 스냅백한다.
    rebuildNodes();
  }
}

function nodeExtraClass(node) {
  const classes = [];
  if (node.data?.unplaced) classes.push("flow-canvas-node--unplaced");
  if (dropHighlight.value && node.id === dropHighlight.value.refId) {
    classes.push(`flow-canvas-drop--${dropHighlight.value.side}`);
  }
  return classes.join(" ");
}

// ----- 패키지/액션 피커에서 새 카드 만들기 -----
// 클릭이든(addUnplacedAction) 흐름도와 무관한 빈 공간으로의 드래그든, 항상 "미배치" 카드로
// 캔버스 여백에 먼저 놓인다 — 어디에 넣을지는 사용자가 그 카드를 직접 흐름도 위로 끌어다
// 놓아(unplacedDragCtx) 결정한다. 다만 피커에서 곧바로 흐름도 위 특정 지점으로 드래그하면
// (onExternalDrop에서 유효한 앵커가 잡히면) 굳이 여백을 거치지 않고 그 자리에 바로 꽂힌다.
let externalDragAnchors = null;
let externalDragBest = null;

function createUnplacedEntry(descriptor, position) {
  const node = createActionNode(descriptor);
  node.__uid = crypto.randomUUID();
  return { node, position };
}

// 새 미배치 카드의 초기 위치 — 현재 보이는 캔버스의 우상단 여백 근처에, 연달아 추가해도 서로
// 완전히 겹치지 않도록 조금씩 대각선으로 쌓는다(카스케이드).
function nextUnplacedPosition() {
  const paneEl = canvasRootRef.value?.querySelector(".vue-flow__pane");
  if (!paneEl) return { x: 0, y: 0 };
  const rect = paneEl.getBoundingClientRect();
  const cascade = (unplacedNodes.value.length % 6) * 28;
  return screenToFlowCoordinate({
    x: rect.left + rect.width - LAYOUT.NODE_W - 40 + cascade,
    y: rect.top + 40 + cascade,
  });
}

function addUnplacedAction(descriptor) {
  if (!props.editable || !descriptor) return;
  unplacedNodes.value.push(createUnplacedEntry(descriptor, nextUnplacedPosition()));
  markDirty("insertAction");
  rebuildNodes();
}

function isExternalActionDrag(event) {
  return !!event.dataTransfer?.types?.includes(ACTION_CATALOG_MIME);
}

function onExternalDragOver(event) {
  if (!props.editable || !isExternalActionDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  if (!externalDragAnchors) {
    externalDragAnchors = buildDropAnchors(editableTree.value, collectDropLists(editableTree.value), boxOf);
  }
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  externalDragBest = nearestAnchorWithin(externalDragAnchors, point, UNPLACED_DROP_RADIUS);
  dropHighlight.value = externalDragBest ? { refId: externalDragBest.refId, side: externalDragBest.side } : null;
}

// .flow-canvas 안의 자식 요소 사이를 지나갈 때도 dragleave가 뜬다 — relatedTarget이 여전히
// 캔버스 내부면 실제로 벗어난 게 아니므로 무시한다(안 그러면 하이라이트가 깜빡인다).
function onExternalDragLeave(event) {
  if (!isExternalActionDrag(event)) return;
  // relatedTarget은 EventTarget일 뿐 Node가 아닐 수 있다(Qodo 리뷰, ActionBox의
  // elementContainsTarget과 동일 패턴) — Node가 아니면 contains() 없이 그냥 바깥으로 취급한다.
  if (event.relatedTarget instanceof Node && canvasRootRef.value?.contains(event.relatedTarget)) return;
  dropHighlight.value = null;
  externalDragAnchors = null;
  externalDragBest = null;
}

function onExternalDrop(event) {
  if (!props.editable || !isExternalActionDrag(event)) return;
  event.preventDefault();
  const raw = event.dataTransfer.getData(ACTION_CATALOG_MIME);
  const best = externalDragBest;
  dropHighlight.value = null;
  externalDragAnchors = null;
  externalDragBest = null;
  if (!raw) return;
  let descriptor;
  try {
    descriptor = JSON.parse(raw);
  } catch {
    return;
  }
  if (best) {
    // 흐름도 위 정확한 지점으로 드롭됨 — 여백을 거치지 않고 바로 트리에 꽂는다.
    insertAt(editableTree.value, best.listPath, best.targetIndex, createActionNode(descriptor));
    assignUiIds(editableTree.value);
    markDirty("insertAction");
  } else {
    // 흐름과 무관한 빈 공간에 드롭됨 — 그 자리에 미배치 카드로 놓는다.
    const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
    unplacedNodes.value.push(
      createUnplacedEntry(descriptor, { x: point.x - LAYOUT.NODE_W / 2, y: point.y - LAYOUT.NODE_H / 2 }),
    );
    markDirty("insertAction");
    rebuildNodes();
  }
}

// ----- 저장/취소 (flow-window의 FlowWindowApp이 이 메서드/ref를 템플릿 ref로 호출) -----
function summaryLabel(key) {
  return t(`recommendFlow.changeSummary.${key}`);
}

async function save(saveFn) {
  // 미배치 카드가 남아 있는 채로 저장하면 그 카드는 백엔드에 아예 안 실려(트리 밖이라) 조용히
  // 사라진 것처럼 보인다 — FlowWindowApp이 저장 버튼 자체를 막아 주지만, 방어적으로 한 번 더 막는다.
  if (!dirty.value || saving.value || unplacedNodes.value.length > 0) return;
  saving.value = true;
  try {
    const summary = pendingSummaries.value.map(summaryLabel).join(", ") || null;
    // saveFn(pipeline.saveRecommendationEdit)은 저장 실패(백엔드 검증 오류 등)해도 던지지
    // 않고 recommendSaveError만 세운 채 정상적으로 resolve한다(설계상 의도 — 흐름도 화면
    // 자체가 사라지지 않게). 그 반환값으로 성공 여부를 명시적으로 받아야 한다 — 반환값을
    // 무시하고 무조건 dirty를 꺼버리면, 실패했는데도 "저장됨" 취급돼 저장/취소 버튼이
    // 통째로 사라지고 "편집 종료"만 남아 사용자가 다시 시도할 방법이 없어진다.
    // ok는 반드시 명시적으로 true여야 dirty를 지운다 — !== false로 느슨하게 받으면 콜백이
    // return을 깜빡해 undefined가 와도(가장 흔한 실수) 성공으로 오판해 이 계약을 만든 목적
    // (실패해도 저장/취소 버튼이 사라지지 않게 하는 것) 자체가 조용히 무너진다(Qodo 리뷰).
    const ok = await saveFn(stripUiIds(editableTree.value), summary);
    if (ok === true) {
      dirty.value = false;
      pendingSummaries.value = [];
    }
  } finally {
    saving.value = false;
  }
}

function discard() {
  editableTree.value = assignUiIds(cloneTree(props.steps));
  unplacedNodes.value = [];
  dirty.value = false;
  pendingSummaries.value = [];
}

// "이미지로 저장" 전용 캡처 대상 계산 — vue-flow 공식 이미지 내보내기 레시피(getRectOfNodes +
// getTransformForBounds)를 따른다. 지금 화면에 보이는 팬/줌으로 캡처하면(html-to-image는 DOM을
// 보이는 대로만 찍는다) 화면 밖으로 벗어난 나머지가 잘리고, 화면에 맞춰 fitView로 줌아웃해서
// 캡처하면 그만큼 텍스트가 작게 찍혀 화질이 나빠진다 — 대신 전체 노드의 바운딩 박스를 구해
// "노드 실제 크기 × EXPORT_SCALE"을 목표 해상도로 정하고, 거기에 맞는 transform을 계산해
// html-to-image의 style 옵션으로 클론에만 적용한다(실제 화면의 팬/줌은 전혀 안 건드리므로
// 캡처 후 되돌릴 것도 없다).
// ⚠️ 캡처 대상은 반드시 .vue-flow__transformationpane이어야 한다 — 실제 팬/줌 transform이
// 걸려 있는 엘리먼트가 바로 이것이다(vue-flow의 Transform 컴포넌트). 겉의 .vue-flow__viewport는
// 그 transform이 없는 데다 overflow:clip까지 걸려 있어, 거길 캡처 대상으로 삼으면 우리가 준
// transform이 새로 걸리는 게 아니라 안쪽 transformationpane의 "현재 실제 팬/줌" 위에 하나 더
// 겹쳐져(이중 transform) 엉뚱한 위치가 찍히고, 그 결과가 클립까지 당해 흐름도가 잘려 나간다.
const EXPORT_SCALE = 2; // 노드 실제 크기(zoom=1) 대비 배율 — 클수록 텍스트가 선명해진다
const EXPORT_MAX_SIDE = 4096; // 아주 큰 흐름도에서도 캔버스 한 변이 이 값을 넘지 않게 하는 상한

function getImageCaptureTarget() {
  const viewportEl = canvasRootRef.value?.querySelector(".vue-flow__transformationpane");
  // getRectOfNodes는 store가 측정해 둔 computedPosition/dimensions가 있어야 하므로, 우리
  // 로컬 nodes(레이아웃 계산 직후의 원시 position/width/height)가 아니라 getNodes(store가
  // 실제로 렌더한 뒤 채워 넣는 값)를 넘겨야 한다 — 안 그러면 좌표가 비어 NaN 바운딩이 나온다.
  // 미배치 카드(data.unplaced)는 트리에 편입되지 않은 임시 카드라 바운딩·캡처 대상에서 뺀다
  // (Qodo 리뷰) — 안 빼면 캡처 이미지에 미배치 카드가 찍히거나 불필요한 여백이 생긴다.
  const measuredNodes = getNodes.value.filter((n) => !n.data?.unplaced);
  if (!viewportEl || !measuredNodes.length) return null;
  const bounds = getRectOfNodes(measuredNodes);
  const scale = Math.min(EXPORT_SCALE, EXPORT_MAX_SIDE / Math.max(bounds.width, bounds.height, 1));
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);
  const { x, y, zoom } = getTransformForBounds(bounds, width, height, 0.1, 4, 0.05);
  // 엣지 연결선(.vue-flow__edge-path)의 fill:none은 CSS 클래스로만 지정돼 있는데, html-to-image가
  // 캡처를 위해 이 서브트리를 복제·직렬화하는 과정에서 그 클래스 규칙이 간헐적으로 안 먹혀
  // SVG path의 기본값(fill: black)대로 그려질 때가 있다 — 가늘어야 할 연결선이 꺾이는 지점마다
  // 뾰족한 검은 도형으로 찍히는 원인이다(Try/Catch처럼 선이 많이 꺾이는 구간일수록 두드러진다).
  // CSS 캐스케이드에 기대지 않고 fill 속성 자체를 엘리먼트에 직접 박아 두면 캡처 방식과 무관하게
  // 항상 안전하다 — 이미 CSS가 강제하는 값과 같아서 화면상 보이는 모습은 전혀 안 바뀐다.
  viewportEl.querySelectorAll(".vue-flow__edge-path").forEach((path) => {
    path.setAttribute("fill", "none");
  });
  return {
    element: viewportEl,
    width,
    height,
    // .vue-flow__transformationpane는 조상인 .flow-canvas의 배경(--surface-sunken, 라이트/
    // 다크 테마에 따라 값이 다르다)을 물려받지 않는 별도 서브트리라, 캡처엔 배경이 안 실린다.
    // 흰 배경을 고정으로 박으면 다크 모드에서 그 배경을 전제로 한 옅은 텍스트(단계 라벨 등)가
    // 거의 안 보이게 되므로, 지금 실제로 렌더되는 배경색을 그대로 읽어 캡처에 반영한다.
    backgroundColor: getComputedStyle(canvasRootRef.value).backgroundColor,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
  };
}

// "DOCX로 내보내기" 전용 — 캡처 직전 스텝을 페이지 단위로 잘라 exportPages를 채운다. 페이지
// 수만 반환하고 그리지는 않는다(각 페이지는 captureExportPage로 순서대로 그려 캡처).
function prepareExportPages() {
  const pages = buildFlowGraphPages(editableTree.value);
  exportPages.value = pages;
  exportPageIndex.value = 0;
  return pages.length;
}

// index번째 페이지로 화면을 바꾸고 캡처 대상을 계산한다. nextTick 두 번은 nodes/edges 갱신과
// vue-flow store 반영까지만 보장한다 — 페이지가 바뀔 때마다 노드 id 집합이 통째로 새로
// 마운트되는데(이전 페이지 노드와 겹치지 않음), vue-flow는 ResizeObserver로 실제 렌더 크기를
// 재기 전까지 새 노드를 visibility:hidden으로 그린다(node.dimensions가 아직 0이라
// isInit=false). 그 측정은 Vue의 리액티브 큐가 아니라 브라우저 페인트 주기에 걸려 nextTick만
// 으론 안 끝난다 — rAF를 두 번 겹쳐 기다려 측정이 끝난 뒤에 캡처해야 페이지 내용이 안 빠진다.
async function captureExportPage(index) {
  exportPageIndex.value = index;
  await nextTick();
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return getImageCaptureTarget();
}

function endExportCapture() {
  exportPages.value = null;
}

defineExpose({
  dirty,
  saving,
  save,
  discard,
  getImageCaptureTarget,
  prepareExportPages,
  captureExportPage,
  endExportCapture,
  addUnplacedAction,
});
</script>

<template>
  <div
    class="flow-canvas"
    ref="canvasRootRef"
    @dragover="onExternalDragOver"
    @dragleave="onExternalDragLeave"
    @drop="onExternalDrop"
  >
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="editable"
      :nodes-connectable="false"
      :edges-updatable="false"
      :min-zoom="0.2"
      :max-zoom="2"
      @node-drag-start="onNodeDragStart"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
    >
      <template #node-action="nodeProps">
        <ActionNode v-bind="nodeProps" :class="nodeExtraClass(nodeProps)" />
      </template>
      <template #node-container="nodeProps">
        <ContainerNode v-bind="nodeProps" :class="nodeExtraClass(nodeProps)" />
      </template>
      <template #node-branchSet="nodeProps">
        <BranchSetNode v-bind="nodeProps" :class="nodeExtraClass(nodeProps)" />
      </template>
      <template #node-branchColumn="nodeProps">
        <BranchColumnNode v-bind="nodeProps" :class="nodeExtraClass(nodeProps)" />
      </template>
      <template #node-label="nodeProps">
        <LabelNode v-bind="nodeProps" :class="nodeExtraClass(nodeProps)" />
      </template>
      <Background :gap="20" />
      <Controls />
    </VueFlow>
  </div>
</template>
