// steps[].actions[].children[]... 트리를 Vue Flow { nodes, edges }로 변환하는 순수 레이아웃 엔진.
// FlowSequence.vue(읽기 전용, CSS 플렉스/들여쓰기 레일)와 같은 분기 그룹핑 규칙(buildSegments)을
// 공유하되, 여기서는 좌표를 직접 계산해 절대 위치(position)로 배치한다.
//
// 설계상 단순화: 모든 노드는 고정 크기 박스로 취급한다(라벨은 2줄 말줄임) — 콘텐츠 높이에 따라
// 다시 재는 2-pass 측정(ResizeObserver)이 필요 없어진다. 또한 Vue Flow의 parentNode/extent(부모-자식
// 좌표 상속) 기능은 쓰지 않고 모든 노드를 하나의 절대좌표 공간에 배치한다 — 드래그는 어차피
// FlowCanvas가 자체 로직(소스 오브 트루스=트리)으로 처리하고 매번 이 함수로 위치를 다시 계산해
// 덮어쓰므로, 컨테이너 노드가 화면상 자식들을 "품고 있는 프레임"이면 충분하고 Vue Flow 쪽의
// 자동 부모-자식 좌표 상속은 필요 없다.
import { MarkerType } from "@vue-flow/core";
import { buildSegments, buildPackageColorMap, branchColumnExits, branchRole, branchLabel, stepLabel } from "./recommendation";
import { nodePathToListPath } from "./flowTree";
import { t } from "../i18n";

export const LAYOUT = {
  NODE_W: 300,
  NODE_H: 72,
  V_GAP: 48,
  H_GAP: 24,
  PAD: 16,
  LABEL_H: 28,
  ROLE_BADGE_H: 24,
  BRANCH_PAD: 16,
  PILL_W: 140,
  PILL_H: 44,
  STEP_TITLE_W: 340,
  STEP_TITLE_H: 28,
};

function makeEdge(source, target) {
  return {
    id: `e-${source}->${target}`,
    source,
    target,
    type: "smoothstep",
    sourceHandle: "out",
    targetHandle: "in",
    // color는 그대로 marker polyline에 인라인 style로 박히므로(vue-flow가 CSS로 덮어쓸 여지가
    // 없다), 여기서 var()로 직접 테마 색을 지정한다 — 하드코딩한 헥스값이면 다크모드에서 안 맞다.
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-text)" },
  };
}

// 라벨이 잘리지 않도록 노드 헤더(번호+라벨+패키지 태그+수정버튼)가 한 줄에 다 들어가는 폭을
// canvas 2D context의 measureText로 실측한다 — DOM에 실제로 그려보지 않고도(2-pass 리플로우 없이)
// 정확한 텍스트 폭을 얻을 수 있어, "고정 크기 박스" 단순화를 유지하면서도 말줄임을 없앨 수 있다.
let measureCtx = null;
function measureTextWidth(text, font) {
  if (typeof document === "undefined") return text.length * 8;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const LABEL_FONT = "700 13px Inter, Pretendard, ui-sans-serif, sans-serif";
const TAG_FONT = "700 11.5px Inter, Pretendard, ui-sans-serif, sans-serif";
const NUM_FONT = "800 13px Inter, Pretendard, ui-sans-serif, sans-serif";
const CONFIDENCE_FONT = "800 11px Inter, Pretendard, ui-sans-serif, sans-serif";

// ActionBox.vue의 실제 CSS(.flow-box padding, gap 등)에 대략 맞춘 여유값을 더해 헤더 폭을 추정한다.
// 신뢰도 배지(.flow-box__confidence)·근거 버튼(ⓘ)은 값이 있을 때만 렌더되므로 폭 계산에서
// 빠지면(예전 버전) 그만큼 액션 텍스트가 밀려 말줄임(…)된다 — 실제로 나타나는 요소만큼 정확히
// 더해야 한다. 편집 버튼(✎)·삭제 버튼(🗑)은 편집 모드 여부가 이 시점(레이아웃 계산)엔 아직
// 안 정해져 있어 늘 있다고 가정한다(과소추정보다 살짝 넉넉한 게 안전).
function estimateNodeWidth(node) {
  const label = node.label || node.action || t("recommendation.untitledAction");
  const pkg = node.package || t("common.unspecified");
  const numW = measureTextWidth("00.00", NUM_FONT) + 4; // 번호("12.3" 등) 최대 폭 여유
  const labelW = measureTextWidth(label, LABEL_FONT);
  const tagW = measureTextWidth(pkg, TAG_FONT) + 20; // 태그 좌우 패딩
  const hasConfidence = node.confidence != null;
  const confidenceW = hasConfidence
    ? measureTextWidth(`${Math.round(node.confidence * 100)}%`, CONFIDENCE_FONT) + 14 // .flow-box__confidence 좌우 패딩(2px+7px)*2
    : 0;
  const hasEvidence = !!node.rationale || (node.sources?.length ?? 0) > 0;
  const evidenceBtnW = hasEvidence ? 22 : 0; // .flow-canvas-box__evidence-btn(ⓘ)
  const editBtnW = 22; // .flow-canvas-box__edit-btn(✎)
  const deleteBtnW = 22; // .flow-canvas-box__delete-btn(🗑)
  const rowGaps = (hasConfidence ? 3 : 2) * 6; // .flow-canvas-box__row 안 flex gap(번호-라벨-태그-[신뢰도])
  const siblingGaps = (hasEvidence ? 3 : 2) * 12; // .flow-box 안 row-버튼들 사이 gap(각 12px)
  const boxPadding = 28; // .flow-box 좌우 padding
  const total =
    numW + labelW + tagW + confidenceW + evidenceBtnW + editBtnW + deleteBtnW + rowGaps + siblingGaps + boxPadding + 4;
  return Math.max(LAYOUT.NODE_W, Math.round(total));
}

// items: [{ node, nodePath }] — 형제 액션 목록 하나를 centerX에 중앙정렬해 세로로 쌓는다.
// 반환: 이 리스트 전체의 크기, 노드/엣지, 진입점(topId, 첫 세그먼트로 연결용), 진출점들(exitIds).
function layoutList(items, centerX, y, ctx) {
  const segments = buildSegments(items.map((it) => ({ node: it.node, path: it.nodePath.join("."), nodePath: it.nodePath })));
  let cy = y;
  let width = LAYOUT.NODE_W;
  const nodes = [];
  const edges = [];
  let topId = null;
  let prevExitIds = null;

  segments.forEach((seg) => {
    const result = seg.type === "node" ? layoutNodeSegment(seg.item, centerX, cy, ctx) : layoutBranchSegment(seg, centerX, cy, ctx);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
    width = Math.max(width, result.width);
    if (topId === null) topId = result.topId;
    if (prevExitIds) prevExitIds.forEach((id) => edges.push(makeEdge(id, result.topId)));
    cy += result.height + LAYOUT.V_GAP;
    prevExitIds = result.exitIds;
  });

  const height = segments.length ? cy - y - LAYOUT.V_GAP : 0;
  return { width, height, nodes, edges, topId, exitIds: prevExitIds ?? [] };
}

// 일반 액션(리프) 또는 단일 컨테이너(Loop/Step/단독 If) 세그먼트 하나를 배치한다.
// 컨테이너 여부는 children 배열의 길이가 아니라 존재(Array.isArray) 자체로 판단한다 — 카탈로그
// 피커로 막 추가한 컨테이너 액션은 children: []으로 시작해서(RPA-289), length 기준이면 리프로
// 오인되어 프레임 없이 렌더되고 그 안으로 드롭도 받을 수 없었다.
function layoutNodeSegment(item, centerX, y, ctx) {
  const node = item.node;
  const uid = node.__uid;
  const isContainer = Array.isArray(node.children);
  const data = {
    label: node.label || node.action || t("recommendation.untitledAction"),
    prefix: ctx.prefixes.get(uid) ?? "",
    pkg: node.package || t("common.unspecified"),
    color: ctx.colorFor(node.package),
    isContainer,
    nodePath: item.nodePath,
    segment: { listPath: nodePathToListPath(item.nodePath), startIndex: item.nodePath[item.nodePath.length - 1], count: 1 },
    rationale: node.rationale ?? null,
    sources: node.sources ?? [],
    confidence: node.confidence ?? null,
  };

  if (!isContainer) {
    const w = estimateNodeWidth(node);
    const x = centerX - w / 2;
    return {
      width: w,
      height: LAYOUT.NODE_H,
      nodes: [{ id: uid, type: "action", position: { x, y }, width: w, height: LAYOUT.NODE_H, data, draggable: true, zIndex: 2 }],
      edges: [],
      topId: uid,
      exitIds: [uid],
    };
  }

  const childItems = node.children.map((c, i) => ({ node: c, nodePath: [...item.nodePath, "children", i] }));
  const childLayout = layoutList(childItems, centerX, y + LAYOUT.NODE_H + LAYOUT.PAD, ctx);
  const frameW = Math.max(estimateNodeWidth(node), childLayout.width) + LAYOUT.PAD * 2;
  const frameH = LAYOUT.NODE_H + LAYOUT.PAD + childLayout.height + LAYOUT.PAD;
  const frameX = centerX - frameW / 2;

  const nodes = [
    { id: uid, type: "container", position: { x: frameX, y }, width: frameW, height: frameH, data, draggable: true, zIndex: 0 },
    ...childLayout.nodes,
  ];
  const edges = [...childLayout.edges];
  if (childLayout.topId) edges.push(makeEdge(uid, childLayout.topId));

  return {
    width: frameW,
    height: frameH,
    nodes,
    edges,
    topId: uid,
    exitIds: childLayout.exitIds.length ? childLayout.exitIds : [uid],
  };
}

// measureColumnSize(크기만 필요)와 layoutColumn(실제 위치까지 필요)이 같은 자식 목록을 각각
// layoutList로 다시 계산하면 중첩 분기에서 하위 서브트리가 계속 두 번씩 겹쳐 계산된다(깊이가
// 늘수록 배로 불어남). layoutList의 결과 좌표는 (centerX, y) 시작점의 선형함수라 원점(0,0)
// 기준으로 한 번만 계산해 캐싱해 두고, 실제 위치가 필요할 때는 그 결과를 델타만큼 평행이동해
// 재사용한다 — 버려질 그래프를 두 번 만들지 않는다. col.node.__uid로 캐시해 두 함수가 같은
// 컬럼의 자식 목록에 대해 항상 같은 결과를 공유한다.
function layoutListCached(items, uid, ctx) {
  if (ctx.listCache.has(uid)) return ctx.listCache.get(uid);
  const result = layoutList(items, 0, 0, ctx);
  ctx.listCache.set(uid, result);
  return result;
}

function translateLayout(layout, dx, dy) {
  return { ...layout, nodes: layout.nodes.map((n) => ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } })) };
}

// 분기 컬럼 하나(Try/Catch/Finally 또는 If/ElseIf/Else 중 하나)의 프레임 크기만 먼저 잰다
// (좌우로 나란히 놓기 전에 각 컬럼 폭을 알아야 하는 2-pass 중 1pass).
function measureColumnSize(col, ctx) {
  const hasChildren = (col.node.children?.length ?? 0) > 0;
  const headerW = estimateNodeWidth(col.node);
  if (!hasChildren) {
    return { width: headerW + LAYOUT.PAD * 2, height: LAYOUT.ROLE_BADGE_H + LAYOUT.NODE_H + LAYOUT.PAD * 2 };
  }
  const childItems = col.node.children.map((c, i) => ({ node: c, nodePath: [...col.nodePath, "children", i] }));
  const childSize = layoutListCached(childItems, col.node.__uid, ctx); // 위치는 버리고 크기만 쓴다
  return {
    width: Math.max(headerW, childSize.width) + LAYOUT.PAD * 2,
    height: LAYOUT.ROLE_BADGE_H + LAYOUT.NODE_H + LAYOUT.PAD + childSize.height + LAYOUT.PAD * 2,
  };
}

function layoutColumn(col, colCenterX, y, size, exits, ctx) {
  const node = col.node;
  const uid = node.__uid;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const frameX = colCenterX - size.width / 2;
  const data = {
    label: node.label || node.action || t("recommendation.untitledAction"),
    prefix: ctx.prefixes.get(uid) ?? "",
    pkg: node.package || t("common.unspecified"),
    color: ctx.colorFor(node.package),
    isContainer: hasChildren,
    role: branchRole(node),
    terminal: !exits,
    nodePath: col.nodePath,
    rationale: node.rationale ?? null,
    sources: node.sources ?? [],
    confidence: node.confidence ?? null,
  };
  const nodes = [{ id: uid, type: "branchColumn", position: { x: frameX, y }, width: size.width, height: size.height, data, draggable: false, zIndex: 1 }];
  const edges = [];
  let exitIds = [uid];

  if (hasChildren) {
    const childItems = node.children.map((c, i) => ({ node: c, nodePath: [...col.nodePath, "children", i] }));
    const headerBottom = y + LAYOUT.ROLE_BADGE_H + LAYOUT.NODE_H + LAYOUT.PAD;
    const cached = layoutListCached(childItems, uid, ctx);
    const childLayout = translateLayout(cached, colCenterX, headerBottom);
    nodes.push(...childLayout.nodes);
    edges.push(...childLayout.edges);
    if (childLayout.topId) edges.push(makeEdge(uid, childLayout.topId));
    exitIds = childLayout.exitIds.length ? childLayout.exitIds : [uid];
  }

  return { nodes, edges, exitIds: exits ? exitIds : [] };
}

// 분기 세트(Try+Catch+Finally 또는 If+ElseIf+Else) 하나를 배치한다 — 컬럼들을 좌우로 나란히.
function layoutBranchSegment(seg, centerX, y, ctx) {
  const cols = seg.items;
  const sizes = cols.map((col) => measureColumnSize(col, ctx));
  const colsWidth = sizes.reduce((sum, s) => sum + s.width, 0) + LAYOUT.H_GAP * (cols.length - 1);
  const maxColHeight = Math.max(...sizes.map((s) => s.height));
  const frameW = colsWidth + LAYOUT.BRANCH_PAD * 2;
  const frameH = LAYOUT.LABEL_H + maxColHeight + LAYOUT.BRANCH_PAD * 2;
  const frameX = centerX - frameW / 2;
  const branchSetId = `${cols[0].node.__uid}__set`;
  const branchListPath = nodePathToListPath(cols[0].nodePath);

  const nodes = [
    {
      id: branchSetId,
      type: "branchSet",
      position: { x: frameX, y },
      width: frameW,
      height: frameH,
      data: {
        label: branchLabel(seg.pkg),
        segment: { listPath: branchListPath, startIndex: cols[0].nodePath[cols[0].nodePath.length - 1], count: cols.length },
      },
      draggable: true,
      zIndex: -1,
    },
  ];
  const edges = [];
  const exitIds = [];
  let cx = frameX + LAYOUT.BRANCH_PAD;
  const colTopY = y + LAYOUT.LABEL_H + LAYOUT.BRANCH_PAD;

  cols.forEach((col, i) => {
    const size = sizes[i];
    const colCenterX = cx + size.width / 2;
    const exits = branchColumnExits(seg.pkg, col.node, cols);
    const colResult = layoutColumn(col, colCenterX, colTopY, size, exits, ctx);
    nodes.push(...colResult.nodes);
    edges.push(...colResult.edges);
    exitIds.push(...colResult.exitIds);
    cx += size.width + LAYOUT.H_GAP;
  });

  return { width: frameW, height: frameH, nodes, edges, topId: branchSetId, exitIds };
}

// steps[stepIdx]는 액션이 아니라 __uid가 없다 — 이 스텝의 타이틀 라벨 노드 id를 flowDrop.js도
// 같이 알아야(빈 actions[]의 드롭 앵커 기준점) 이름 규칙을 여기 하나로 export해 공유한다.
export function stepTitleId(stepIdx) {
  return `__step-title-${stepIdx}`;
}

function labelNode(id, label, centerX, y, w, h, variant) {
  return { id, type: "label", position: { x: centerX - w / 2, y }, width: w, height: h, data: { label, variant }, draggable: false, selectable: false, zIndex: 3 };
}

// steps[].actions[] 안의 모든 노드에 순번(1, 2, 3… / 4.1, 4.2…)을 매긴다 — numberFlowSteps와
// 동일한 규칙(스텝을 가로지르는 전역 카운터, 자식은 부모 접두어에 이어붙임)이라 rec-detail
// 패널과 이 캔버스가 같은 번호를 보여준다.
function computePrefixes(steps) {
  const map = new Map();
  let n = 0;
  function walkChildren(prefix, children) {
    (children ?? []).forEach((c, i) => {
      const p = `${prefix}.${i + 1}`;
      map.set(c.__uid, p);
      walkChildren(p, c.children);
    });
  }
  (steps ?? []).forEach((step) => {
    (step.actions ?? []).forEach((a) => {
      n += 1;
      const p = String(n);
      map.set(a.__uid, p);
      walkChildren(p, a.children);
    });
  });
  return map;
}

// steps[] 트리(각 노드에 __uid가 이미 부여돼 있어야 함 — flowTree.assignUiIds) → Vue Flow 그래프.
export function buildFlowGraph(steps) {
  const prefixes = computePrefixes(steps);
  const packageColor = buildPackageColorMap(steps);
  const colorFor = (pkg) => packageColor.get(pkg || t("common.unspecified")) ?? "#888888";
  const ctx = { prefixes, colorFor, listCache: new Map() };

  const centerX = 0;
  const nodes = [];
  const edges = [];
  let cy = 0;

  const startId = "__start";
  nodes.push(labelNode(startId, t("recommendFlow.start"), centerX, cy, LAYOUT.PILL_W, LAYOUT.PILL_H, "pill"));
  cy += LAYOUT.PILL_H + LAYOUT.V_GAP;
  let prevExitIds = [startId];

  (steps ?? []).forEach((step, stepIdx) => {
    const titleId = stepTitleId(stepIdx);
    nodes.push(labelNode(titleId, stepLabel(step, stepIdx), centerX, cy, LAYOUT.STEP_TITLE_W, LAYOUT.STEP_TITLE_H, "title"));
    prevExitIds.forEach((id) => edges.push(makeEdge(id, titleId)));
    cy += LAYOUT.STEP_TITLE_H + LAYOUT.V_GAP;

    const items = (step.actions ?? []).map((a, i) => ({ node: a, nodePath: [stepIdx, "actions", i] }));
    if (!items.length) {
      prevExitIds = [titleId];
      return;
    }

    const result = layoutList(items, centerX, cy, ctx);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
    if (result.topId) edges.push(makeEdge(titleId, result.topId));
    cy += result.height + LAYOUT.V_GAP;
    prevExitIds = result.exitIds;
  });

  const doneId = "__done";
  prevExitIds.forEach((id) => edges.push(makeEdge(id, doneId)));
  nodes.push(labelNode(doneId, t("recommendFlow.done"), centerX, cy, LAYOUT.PILL_W, LAYOUT.PILL_H, "pill"));

  return { nodes, edges };
}

// ---------- Export 전용: 스텝 경계에서 여러 페이지로 나눈 레이아웃(RPA-296 후속) ----------
// DOCX는 흐름도 이미지를 고정 폭(6.3in)으로만 삽입하고 높이는 원본 비율 그대로 따라가는데,
// Word는 페이지보다 큰 인라인 그림을 다음 페이지로 이어 그려주지 않고 페이지 경계에서 그냥
// 잘라버린다(자동 페이지 넘김 없음 — 실측 확인됨). 백엔드가 이미지 여러 장을 받아 각 장 사이에
// 페이지 나눔을 넣도록 바뀐 뒤(RPA-296 후속 백엔드 작업)로는, 프론트도 흐름도 원래 모양(세로
// 한 줄)을 그대로 유지한 채 "페이지 한 장에 들어갈 만큼"씩 여러 조각으로 잘라 각각 따로
// 캡처한다 — 컬럼으로 욱여넣지 않으므로 글자 크기가 항상 일정하다. 스텝 "안"에서는 절대
// 끊지 않으므로 컨테이너/분기 프레임이 조각 사이에서 잘리는 일이 없다.

// 스텝 하나(타이틀 라벨 + 그 안의 액션 트리)를 원점(0,0) 기준 독립 블록으로 계산한다 —
// buildFlowGraph의 스텝 루프 본문과 같은 계산이지만, 페이지 분할을 위해 따로 떼어 재사용한다.
function buildStepBlock(step, stepIdx, ctx) {
  const titleId = stepTitleId(stepIdx);
  const titleNode = labelNode(titleId, stepLabel(step, stepIdx), 0, 0, LAYOUT.STEP_TITLE_W, LAYOUT.STEP_TITLE_H, "title");

  const items = (step.actions ?? []).map((a, i) => ({ node: a, nodePath: [stepIdx, "actions", i] }));
  if (!items.length) {
    return { width: LAYOUT.STEP_TITLE_W, height: LAYOUT.STEP_TITLE_H, nodes: [titleNode], edges: [], topId: titleId, exitIds: [titleId] };
  }

  const list = layoutList(items, 0, LAYOUT.STEP_TITLE_H + LAYOUT.V_GAP, ctx);
  const edges = [...list.edges];
  if (list.topId) edges.push(makeEdge(titleId, list.topId));
  return {
    width: Math.max(LAYOUT.STEP_TITLE_W, list.width),
    height: LAYOUT.STEP_TITLE_H + LAYOUT.V_GAP + list.height,
    nodes: [titleNode, ...list.nodes],
    edges,
    topId: titleId,
    exitIds: list.exitIds,
  };
}

// 스텝 블록들을 순서대로 그리디하게 페이지에 채운다 — 다음 블록을 더하면 페이지 높이 상한을
// 넘길 때만 새 페이지로 넘어간다(스텝 하나가 통째로 상한을 넘겨도 쪼개지 않는다). 각 페이지는
// 독립된 이미지로 캡처되므로(컬럼처럼 한 이미지 안에서 나란히 놓는 게 아니다), 컬럼 분할과
// 달리 "전체를 몇 개로 나눌지" 미리 정할 필요 없이 상한 하나만으로 그리디하게 잘라도 충분하다.
function groupIntoPages(blocks, maxHeightToWidthRatio) {
  // 상한 폭을 전체 블록의 최댓값(global)으로 한 번만 정하면, 실제로 더 좁은 블록들만 모인
  // 페이지는 렌더될 때 그 페이지 "자신"의 폭(더 좁음)을 쓰므로 높이:폭 비율이 목표보다 커질 수
  // 있다 — 그래서 "현재 페이지에 지금까지 들어온 블록들의 최댓값 폭"을 매번 갱신해 가며, 항상
  // 그 페이지가 최종적으로 렌더될 때와 같은 폭 기준으로 상한을 판단한다.
  const pages = [];
  let current = [];
  let currentHeight = 0;
  let currentWidth = LAYOUT.PILL_W;
  blocks.forEach((b) => {
    const widthWithNext = Math.max(currentWidth, b.width);
    const heightWithNext = currentHeight + b.height + LAYOUT.V_GAP;
    if (current.length && heightWithNext > widthWithNext * maxHeightToWidthRatio) {
      pages.push(current);
      current = [];
      currentHeight = 0;
      currentWidth = LAYOUT.PILL_W;
    }
    current.push(b);
    currentWidth = Math.max(currentWidth, b.width);
    currentHeight += b.height + LAYOUT.V_GAP;
  });
  if (current.length) pages.push(current);
  return pages;
}

// steps[] → 캡처(DOCX 다중 페이지 내보내기) 전용 Vue Flow 그래프 배열. 배열 원소 하나가 문서의
// 페이지 한 장에 해당하는 흐름도 조각이다 — buildFlowGraph와 같은 세로 한 줄 배치를 그대로
// 유지한 채 스텝 경계에서만 끊는다. "시작" 필은 첫 페이지에만, "완료" 필은 마지막 페이지에만
// 붙인다. 편집 캔버스(buildFlowGraph)와 달리 draggable이 필요 없고, 편집용 드롭 로직
// (flowDrop.js)과도 호환되지 않는다 — 오직 화면에 페이지 순서대로 잠깐씩 띄워 캡처한 뒤
// 버리는 용도로만 쓴다.
export function buildFlowGraphPages(steps, maxHeightToWidthRatio = 8.4 / 6.3) {
  if (!steps?.length) return [buildFlowGraph(steps)];

  const prefixes = computePrefixes(steps);
  const packageColor = buildPackageColorMap(steps);
  const colorFor = (pkg) => packageColor.get(pkg || t("common.unspecified")) ?? "#888888";
  const ctx = { prefixes, colorFor, listCache: new Map() };

  const blocks = steps.map((step, i) => buildStepBlock(step, i, ctx));
  const pages = groupIntoPages(blocks, maxHeightToWidthRatio);

  return pages.map((pageBlocks, pageIdx) => {
    const nodes = [];
    const edges = [];
    const width = Math.max(LAYOUT.PILL_W, ...pageBlocks.map((b) => b.width));
    const centerX = width / 2;
    let cy = 0;

    if (pageIdx === 0) {
      const startId = "__start";
      nodes.push(labelNode(startId, t("recommendFlow.start"), centerX, cy, LAYOUT.PILL_W, LAYOUT.PILL_H, "pill"));
      cy += LAYOUT.PILL_H + LAYOUT.V_GAP;
      if (pageBlocks.length) edges.push(makeEdge(startId, pageBlocks[0].topId));
    }

    pageBlocks.forEach((b, i) => {
      const translated = translateLayout(b, centerX, cy);
      nodes.push(...translated.nodes);
      edges.push(...b.edges);
      cy += b.height + LAYOUT.V_GAP;
      if (i < pageBlocks.length - 1) {
        b.exitIds.forEach((id) => edges.push(makeEdge(id, pageBlocks[i + 1].topId)));
      }
    });

    if (pageIdx === pages.length - 1) {
      const doneId = "__done";
      const lastBlock = pageBlocks[pageBlocks.length - 1];
      (lastBlock?.exitIds ?? []).forEach((id) => edges.push(makeEdge(id, doneId)));
      nodes.push(labelNode(doneId, t("recommendFlow.done"), centerX, cy, LAYOUT.PILL_W, LAYOUT.PILL_H, "pill"));
    }

    return { nodes, edges };
  });
}
