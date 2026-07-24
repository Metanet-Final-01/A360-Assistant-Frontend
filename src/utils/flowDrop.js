// Vue Flow 캔버스의 드래그앤드롭 재정렬 — "어디에 드롭할 수 있는지"만 순수하게 계산한다
// (실제 트리 변형은 flowTree.moveSegment, 화면 좌표 변환은 FlowCanvas가 담당).
//
// 유효한 드롭 리스트 = buildSegments가 인식하는 모든 리스트: 각 step의 actions[], 일반
// 컨테이너(Loop/Step/단독 If)의 children[], 분기 역할 노드(Try/Catch/Finally/If/ElseIf/Else)의
// children[] — 전부 지금 비어 있어도 항상 포함한다. flowLayout이 children 길이가 아니라
// Array.isArray(children)로 컨테이너 여부를 판단해 빈 컨테이너도 항상 "프레임"으로 렌더되므로
// (카탈로그로 막 추가한 컨테이너 액션이 대표적, RPA-289), 여기서도 같은 기준으로 맞춰야 그
// 프레임 안이 드롭 가능한 영역으로 인식된다 — Try/Catch/Finally 사이로는(=세그먼트 내부로는)
// 애초에 앵커가 생기지 않으므로 분기 무결성이 자동으로 보장된다.
import { buildSegments } from "./recommendation";
import { getAt, childListPath } from "./flowTree";
import { stepTitleId } from "./flowLayout";

function walkItems(items, out) {
  const segments = buildSegments(items.map((it) => ({ node: it.node, path: "", nodePath: it.nodePath })));
  segments.forEach((seg) => {
    if (seg.type === "node") {
      const { node, nodePath } = seg.item;
      if (Array.isArray(node.children)) {
        out.push(childListPath(nodePath));
        const childItems = node.children.map((c, i) => ({ node: c, nodePath: [...nodePath, "children", i] }));
        if (childItems.length) walkItems(childItems, out);
      }
    } else {
      seg.items.forEach((col) => {
        out.push(childListPath(col.nodePath));
        const childItems = (col.node.children ?? []).map((c, i) => ({ node: c, nodePath: [...col.nodePath, "children", i] }));
        if (childItems.length) walkItems(childItems, out);
      });
    }
  });
}

export function collectDropLists(steps) {
  const out = [];
  (steps ?? []).forEach((step, stepIdx) => {
    const listPath = [stepIdx, "actions"];
    out.push(listPath);
    const items = (step.actions ?? []).map((a, i) => ({ node: a, nodePath: [stepIdx, "actions", i] }));
    walkItems(items, out);
  });
  return out;
}

// listPaths(유효 드롭 리스트들) 각각에 대해 "삽입 지점" 앵커를 만든다. 세그먼트 N개짜리 리스트는
// N+1개의 삽입 지점(맨 앞·각 세그먼트 사이·맨 뒤)을 갖는다. 빈 리스트는 부모 프레임 자체를
// 기준점으로 하는 "inside" 앵커 하나만 갖는다. boxOf(id)는 { cx, cy, top, bottom } 또는 undefined.
export function buildDropAnchors(steps, listPaths, boxOf) {
  const anchors = [];
  listPaths.forEach((listPath) => {
    const list = getAt(steps, listPath);
    if (!list?.length) {
      // 스텝 최상위 actions[]([stepIdx, "actions"])가 비면 그 부모(step)는 액션이 아니라서
      // __uid가 없다(assignUiIds는 액션에만 부여) — 대신 항상 화면에 있는 그 스텝의 타이틀
      // 라벨 노드를 기준점으로 삼아 "타이틀 바로 아래" 앵커를 만든다. 그 외(컨테이너/분기
      // 역할 노드의 빈 children[])는 부모 액션 자체가 프레임으로 렌더되므로 그 __uid를 쓴다.
      if (listPath.length === 2) {
        const titleBox = boxOf(stepTitleId(listPath[0]));
        if (titleBox) {
          anchors.push({ listPath, targetIndex: 0, refId: stepTitleId(listPath[0]), side: "after", x: titleBox.cx, y: titleBox.bottom });
        }
        return;
      }
      const parentNode = getAt(steps, listPath.slice(0, -1));
      const box = parentNode && boxOf(parentNode.__uid);
      if (box) anchors.push({ listPath, targetIndex: 0, refId: parentNode.__uid, side: "inside", x: box.cx, y: box.cy });
      return;
    }
    const items = list.map((node, i) => ({ node, nodePath: [...listPath, i] }));
    const segments = buildSegments(items.map((it) => ({ node: it.node, path: "", nodePath: it.nodePath })));
    let idx = 0;
    let lastId = null;
    let lastBox = null;
    segments.forEach((seg) => {
      const id = seg.type === "node" ? seg.item.node.__uid : `${seg.items[0].node.__uid}__set`;
      const count = seg.type === "node" ? 1 : seg.items.length;
      const box = boxOf(id);
      if (box) anchors.push({ listPath, targetIndex: idx, refId: id, side: "before", x: box.cx, y: box.top });
      idx += count;
      lastId = id;
      lastBox = box;
    });
    if (lastBox) anchors.push({ listPath, targetIndex: idx, refId: lastId, side: "after", x: lastBox.cx, y: lastBox.bottom });
  });
  return anchors;
}

// point(캔버스 좌표계)에 가장 가까운 앵커를 고른다 — Y축 거리를 우선시해 리스트가 세로로
// 쌓인 레이아웃에서 자연스럽게 "위/아래 어디 사이인지"가 먼저 갈리게 한다.
export function nearestAnchor(anchors, point) {
  let best = null;
  let bestDist = Infinity;
  anchors.forEach((a) => {
    const dy = a.y - point.y;
    const dx = a.x - point.x;
    const dist = dy * dy * 4 + dx * dx;
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  });
  return best;
}
