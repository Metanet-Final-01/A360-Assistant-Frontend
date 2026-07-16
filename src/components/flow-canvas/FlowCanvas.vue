<script setup>
// 추천 작업 흐름도 모달의 인터랙티브 캔버스 — Vue Flow로 확대/축소·팬, 액션 텍스트 인라인 편집,
// 드래그앤드롭 재정렬(컨테이너 무결성 유지)을 제공한다. 소스 오브 트루스는 항상 로컬 편집
// 버퍼(editableTree)고, 화면(nodes/edges)은 매번 그 트리로부터 buildFlowGraph로 다시 계산한다 —
// 드롭이 무효면 다음 렌더에서 트리 기준 위치로 자연히 스냅백된다.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { VueFlow, useVueFlow } from "@vue-flow/core";
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

// dirty/saving은 부모(RecommendationFlowModal)의 저장 버튼이 반응형으로 읽어야 하므로 exposed ref
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
const { setCenter, onNodesInitialized, getViewport, setViewport } = useVueFlow();
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

// ----- 저장/취소 (RecommendationFlowModal이 이 메서드/ref를 템플릿 ref로 호출) -----
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

defineExpose({ dirty, saving, save, discard });
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
