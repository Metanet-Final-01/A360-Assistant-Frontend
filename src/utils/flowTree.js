// Vue Flow 편집 캔버스(FlowCanvas)가 로컬 편집 버퍼(steps[].actions[].children[]...)를 다루기 위한
// 경로 유틸 — recommendation.js의 문자열 path("actions[2].children[0]", 검수 위반 매칭용)와는
// 별개의 스킴이다. 여기서는 경로를 배열(["stepIdx","actions",idx,"children",idx,...])로 다뤄
// 세그먼트 단위로 비교한다 — 문자열 접두어 비교는 "actions[1]"이 "actions[10]"의 접두어로
// 잘못 매칭되는 버그가 있어 피한다.
import { isBranchNode } from "./recommendation";
import { isKnownContainerAction } from "./actionCatalog";

// path/listPath 둘 다 steps 배열 루트에서 시작하는 동일한 세그먼트 배열이다 — path가 배열이 나오면
// "리스트 경로", 액션 객체가 나오면 "노드 경로"일 뿐 함수는 구분하지 않는다.
export function getAt(steps, path) {
  let cur = steps;
  for (const seg of path) cur = cur?.[seg];
  return cur;
}

export function nodePathToListPath(nodePath) {
  return nodePath.slice(0, -1);
}

export function childListPath(nodePath) {
  return [...nodePath, "children"];
}

export function pathsEqual(a, b) {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

// path가 ancestorPath의 진짜 하위(자기 자신 제외)인지 — 드래그 사이클 방지(자기 서브트리 안으로
// 드롭 금지)에 쓴다.
export function isDescendant(ancestorPath, path) {
  return path.length > ancestorPath.length && ancestorPath.every((seg, i) => path[i] === seg);
}

// path가 ancestorPath 자기 자신이거나 하위인지 — 드롭 리스트 유효성 검사(자기 서브트리 전체 배제)에 쓴다.
export function isSelfOrDescendant(ancestorPath, path) {
  return path.length >= ancestorPath.length && ancestorPath.every((seg, i) => path[i] === seg);
}

// nodePath가 가리키는 노드를 부모 리스트에서 떼어내 반환한다(splice, in-place).
export function removeAt(steps, nodePath) {
  const list = getAt(steps, nodePathToListPath(nodePath));
  const idx = nodePath[nodePath.length - 1];
  return list.splice(idx, 1)[0];
}

// listPath가 가리키는 배열의 idx 위치에 node를 끼워 넣는다(splice, in-place).
export function insertAt(steps, listPath, idx, node) {
  const list = getAt(steps, listPath);
  list.splice(idx, 0, node);
}

// segment({listPath, startIndex, count} — 일반 액션 1개 또는 분기 세트 전체 N개 연속 항목)를
// targetListPath의 targetIndex 위치로 옮긴다. 같은 리스트 안에서 뒤로 옮기는 경우, 먼저 떼어낸
// 만큼(count) 뒤쪽 인덱스가 당겨지므로 targetIndex를 보정한다.
export function moveSegment(steps, segment, targetListPath, targetIndex) {
  const sourceList = getAt(steps, segment.listPath);
  const removed = sourceList.splice(segment.startIndex, segment.count);
  const sameList = pathsEqual(segment.listPath, targetListPath);
  const targetList = sameList ? sourceList : getAt(steps, targetListPath);
  const insertAt = sameList && targetIndex > segment.startIndex ? targetIndex - segment.count : targetIndex;
  targetList.splice(insertAt, 0, ...removed);
}

function walkAssignUid(node) {
  if (!node.__uid) node.__uid = crypto.randomUUID();
  (node.children ?? []).forEach(walkAssignUid);
}

// 로컬 편집 버퍼의 모든 액션 노드에 안정적인 Vue Flow node id(__uid)를 부여한다(없을 때만).
// in-place splice로만 트리를 변형하는 한(새 객체로 교체하지 않는 한) 재정렬 후에도 그대로 유지된다.
export function assignUiIds(steps) {
  (steps ?? []).forEach((step) => (step.actions ?? []).forEach(walkAssignUid));
  return steps;
}

function walkStripEmptyChildren(node) {
  if (!Array.isArray(node.children)) return;
  if (node.children.length === 0) {
    // 분기 역할 노드(Try/Catch/Finally/If/ElseIf/Else)는 children이 비어 있어도(예: 액션이
    // 없는 Else 분기) flowDrop.collectDropLists가 그 children[] 경로를 항상 드롭 가능 리스트로
    // 내놓는다(분기 컬럼은 children 유무와 무관하게 항상 프레임으로 보여야 하므로) — 여기서
    // children 자체를 지워버리면 그 경로가 undefined가 되어, 드롭 시 insertAt()의
    // list.splice()가 예외를 던진다(Qodo 리뷰).
    // 분기 노드가 아니어도, 카탈로그에 컨테이너로 등록된 액션(예: Loop/Step)이면 실제로 비어
    // 있는 컨테이너일 수 있다 — 저장 시점엔 하위 액션이 없었을 뿐 리프로 바뀐 게 아니다(Qodo
    // 리뷰: 안 지우면 재로드 후 프레임·드롭 대상 자격을 잃어 다시 채울 수 없게 된다). 카탈로그가
    // 컨테이너로 알고 있는 액션과 분기 노드만 남기고, 그 외(백엔드 스키마 기본값일 뿐인 진짜
    // 리프)의 children[]만 지운다.
    if (!isBranchNode(node) && !isKnownContainerAction(node.package, node.action)) delete node.children;
    return;
  }
  node.children.forEach(walkStripEmptyChildren);
}

// 백엔드 RecommendedAction 스키마는 children을 항상 list(default_factory=list)로 내려보내
// 리프 액션도 children: []을 갖는다. flowLayout/flowDrop은 (RPA-289로 빈 컨테이너를 프레임
// 없는 리프로 오인하던 버그를 고치려고) children 길이가 아니라 Array.isArray(children)로
// 컨테이너 여부를 판단하므로, 백엔드에서 막 불러온 트리를 그대로 넘기면 모든 리프 액션이
// 컨테이너 프레임(점선 테두리)으로 잘못 렌더된다. 백엔드 트리를 로컬 편집 버퍼로 복제하는
// 시점에 한 번, 실제로 비어 있는 children[]을 지워 진짜 컨테이너(children이 있었던 노드)만
// 남긴다 — 카탈로그로 새로 만든 빈 컨테이너나 사용자가 편집 중 만든 children[]은 이 시점
// 이후에 생기므로 영향받지 않는다. 분기 역할 노드는 예외(위 walkStripEmptyChildren 참고).
export function stripEmptyChildren(steps) {
  (steps ?? []).forEach((step) => (step.actions ?? []).forEach(walkStripEmptyChildren));
  return steps;
}

function stripNode({ __uid, children, ...rest }) {
  return children ? { ...rest, children: children.map(stripNode) } : rest;
}

// 저장 직전 __uid를 제거한 딥카피를 만든다 — 백엔드 Recommendation 스키마에 없는 필드라 그대로
// 보내면 안 된다.
export function stripUiIds(steps) {
  return (steps ?? []).map((step) => ({ ...step, actions: (step.actions ?? []).map(stripNode) }));
}
