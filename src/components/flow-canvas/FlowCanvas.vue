<script setup>
// 추천 작업 흐름도 모달의 인터랙티브 캔버스 — Vue Flow로 확대/축소·팬, 액션 텍스트 인라인 편집,
// 드래그앤드롭 재정렬(컨테이너 무결성 유지)을 제공한다. 소스 오브 트루스는 항상 로컬 편집
// 버퍼(editableTree)고, 화면(nodes/edges)은 매번 그 트리로부터 buildFlowGraph로 다시 계산한다 —
// 드롭이 무효면 다음 렌더에서 트리 기준 위치로 자연히 스냅백된다.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

import { buildFlowGraph } from "../../utils/flowLayout";
import { assignUiIds, stripUiIds, getAt, isSelfOrDescendant, moveSegment, childListPath } from "../../utils/flowTree";
import { collectDropLists, buildDropAnchors, nearestAnchor } from "../../utils/flowDrop";

const props = defineProps({
  steps: { type: Array, default: () => [] },
  editable: { type: Boolean, default: true },
});

// dirty/saving은 부모(flow-window의 FlowWindowApp)의 저장 버튼이 반응형으로 읽어야 하므로 exposed ref
// 대신 이벤트로 내보낸다 — 템플릿 ref를 통한 중첩 ref 언래핑에 기대지 않는 게 더 안전하다.
const emit = defineEmits(["update:dirty", "update:saving"]);
const { t } = useI18n();

function cloneTree(steps) {
  return JSON.parse(JSON.stringify(steps ?? []));
}

const editableTree = ref(assignUiIds(cloneTree(props.steps)));
const dirty = ref(false);
const saving = ref(false);
const pendingSummaries = ref([]);

watch(dirty, (v) => emit("update:dirty", v));
watch(saving, (v) => emit("update:saving", v));

// 외부(버전 되돌리기 등)에서 steps가 바뀌면 그게 새 정답이다 — 저장 안 한 로컬 편집(dirty)이
// 있어도 무시하고 무조건 새 steps로 다시 맞춘다. 예전엔 dirty면 건너뛰어서, 되돌리기 직후
// "저장"을 누르면 낡은 로컬 편집이 방금 되돌린 버전을 덮어써 버리는 문제가 있었다.
watch(
  () => props.steps,
  (next) => {
    editableTree.value = assignUiIds(cloneTree(next));
    dirty.value = false;
    pendingSummaries.value = [];
  },
);

function markDirty(summaryKey) {
  dirty.value = true;
  if (!pendingSummaries.value.includes(summaryKey)) pendingSummaries.value.push(summaryKey);
}

const graph = computed(() => buildFlowGraph(editableTree.value));

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
      onCommit: (text) => {
        const target = getAt(editableTree.value, nodePath);
        if (target) {
          target.label = text;
          markDirty("editLabel");
        }
      },
    },
  };
}

const nodes = ref([]);
const edges = ref([]);
watch(
  graph,
  (g) => {
    nodes.value = g.nodes.map(enrich);
    edges.value = g.edges;
  },
  { immediate: true },
);

// editable은 트리와 무관하게(편집 모드 토글) 바뀌므로 graph의 watch만으로는 이미 렌더된
// 노드들의 draggable/onCommit이 갱신되지 않는다 — 별도로 다시 적용한다.
watch(
  () => props.editable,
  () => {
    nodes.value = graph.value.nodes.map(enrich);
  },
);

// 처음 열었을 때 전체 흐름도를 한 화면에 욱여넣으면(기본 fitView 동작) 글씨가 너무 작아진다 —
// "시작"이 캔버스 상단 가까이 보이는 100% 줌으로 시작하고, 나머지는 팬/스크롤로 보게 한다.
// fitView(nodes 서브셋 + padding)로는 대칭 패딩 때문에 "시작"이 항상 화면 중앙에 오게 돼서,
// 대신 setCenter로 "시작 필 중심에서 화면 절반 - 여백만큼 아래"인 지점을 화면 중앙에 맞춘다
// (그러면 시작 필 자체는 화면 상단 여백(topMargin)에 위치하게 된다).
const canvasRootRef = ref(null);
const { setCenter, onNodesInitialized, getViewport, setViewport, getNodes } = useVueFlow();
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

// ----- 드래그 재정렬 -----
const dropHighlight = ref(null); // { refId, side } | null
let dragCtx = null;

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
  const segment = node.data?.segment;
  if (!segment || !props.editable) return;
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
  if (!dragCtx || node.id !== dragCtx.rootId) return;
  const { segment, current } = dragCtx;
  dropHighlight.value = null;
  dragCtx = null;
  if (current) {
    moveSegment(editableTree.value, segment, current.listPath, current.targetIndex);
    markDirty("reorder");
  } else {
    // 유효한 드롭 지점 없이 놓임 — 트리는 안 바뀌었으니 트리 기준 위치로 다시 그려 스냅백한다.
    nodes.value = graph.value.nodes.map(enrich);
  }
}

function nodeExtraClass(node) {
  if (!dropHighlight.value || node.id !== dropHighlight.value.refId) return "";
  return `flow-canvas-drop--${dropHighlight.value.side}`;
}

// ----- 저장/취소 (flow-window의 FlowWindowApp이 이 메서드/ref를 템플릿 ref로 호출) -----
function summaryLabel(key) {
  return t(`recommendFlow.changeSummary.${key}`);
}

async function save(saveFn) {
  if (!dirty.value || saving.value) return;
  saving.value = true;
  try {
    const summary = pendingSummaries.value.map(summaryLabel).join(", ") || null;
    await saveFn(stripUiIds(editableTree.value), summary);
    dirty.value = false;
    pendingSummaries.value = [];
  } finally {
    saving.value = false;
  }
}

function discard() {
  editableTree.value = assignUiIds(cloneTree(props.steps));
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
  const measuredNodes = getNodes.value;
  if (!viewportEl || !measuredNodes.length) return null;
  const bounds = getRectOfNodes(measuredNodes);
  const scale = Math.min(EXPORT_SCALE, EXPORT_MAX_SIDE / Math.max(bounds.width, bounds.height, 1));
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);
  const { x, y, zoom } = getTransformForBounds(bounds, width, height, 0.1, 4, 0.05);
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

defineExpose({ dirty, saving, save, discard, getImageCaptureTarget });
</script>

<template>
  <div class="flow-canvas" ref="canvasRootRef">
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
        <LabelNode v-bind="nodeProps" />
      </template>
      <Background :gap="20" />
      <Controls />
    </VueFlow>
  </div>
</template>
