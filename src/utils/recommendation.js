// RecommendedAction 트리(schemas/recommendation.py) 공용 헬퍼 — 분석 결과 패널(상세 보기)과
// 흐름도 모달(요약 보기)이 같은 방식으로 펼치고 같은 패키지 색을 쓰도록 공유한다.
// 흐름도 step은 분석(WorkStep) 단계와 1:1이 아니다(에이전트가 자유롭게 합치고 쪼갠다) —
// step_id로 분석 결과와 매칭하지 않고, 흐름도 데이터(steps[].label/description/actions)만으로
// 독립적으로 렌더한다.
import { t } from "../i18n";

const PALETTE = ["#1f6f8b", "#7c5cbf", "#b7791f", "#1f9d55", "#d84a3a", "#2f6fa8", "#a8447a", "#55607a"];

// Loop/If 같은 컨테이너 액션의 children까지 재귀적으로 펼쳐, 상세/요약 보기 모두에 필요한 필드를 담는다.
export function flattenDetailed(actions) {
  const result = [];
  function walk(list) {
    (list ?? []).forEach((a) => {
      result.push({
        package: a.package || t("common.unspecified"),
        action: a.action,
        label: a.label || a.action,
        parameters: a.parameters ?? [],
        confidence: a.confidence,
      });
      if (a.children?.length) walk(a.children);
    });
  }
  walk(actions);
  return result;
}

// 패키지별 색상은 고정된 의미 매핑이 아니라, steps를 훑으면서 처음 등장한 순서대로 팔레트를 배정한다.
// steps 순서가 같으면 두 화면에서 같은 패키지가 항상 같은 색으로 보인다.
export function buildPackageColorMap(steps) {
  const map = new Map();
  function walk(actions) {
    (actions ?? []).forEach((a) => {
      const key = a.package || t("common.unspecified");
      if (!map.has(key)) map.set(key, PALETTE[map.size % PALETTE.length]);
      if (a.children?.length) walk(a.children);
    });
  }
  (steps ?? []).forEach((stepRec) => walk(stepRec.actions));
  return map;
}

// 흐름도 step 제목 폴백: label → step_id → "단계 N"/"Step N".
export function stepLabel(step, idx) {
  return step.label || step.step_id || t("recommendation.stepFallback", { n: idx + 1 });
}

// 흐름도 steps를 트리 렌더용으로 정규화한다 — 상위 액션에 스텝을 가로지르는 전역 순번(1,2,3…)을
// 매기고, 자식 번호(4.1…)와 중첩은 FlowNode가 재귀로 붙인다. path는 검수 위반 location과 매칭용.
// 패널(추천 흐름도 상세)과 캔버스(FlowCanvas의 flowLayout)가 같은 번호를 쓰도록 공유한다.
export function numberFlowSteps(steps) {
  let n = 0;
  return (steps ?? []).map((step, idx) => ({
    key: step.step_id ?? idx,
    step_id: step.step_id,
    title: stepLabel(step, idx),
    description: step.description,
    items: (step.actions ?? []).map((a, i) => ({ node: a, prefix: String((n += 1)), path: `actions[${i}]` })),
  }));
}

// 컬럼(다른 열)으로 분기 렌더할 패키지 — Try/Catch/Finally(Error handler), If/Else If/Else(If).
// Loop·Step은 컨테이너지만 분기가 아니라 단일 본문이므로 들여쓰기 중첩으로 그린다.
const BRANCH_PACKAGES = new Set(["Error handler", "If"]);

// 이 노드를 분기(다른 열)로 그릴 후보인지 — 본문 없는 제어 액션(Throw)은 제외.
export function isBranchNode(node) {
  return !!node && BRANCH_PACKAGES.has(node.package) && node.action !== "errorHandlerThrow";
}

// 새 분기 그룹을 시작하는 노드(Try·원초 If) — 연속한 분기 사이에서 별개 블록을 가른다.
// (Catch/Finally·Else If/Else 등은 앞 분기의 '다른 열'로 이어진다.) 원초 If를 스타터로
// 넣지 않으면 나란한 독립 If 블록 두 개가 한 그룹으로 병합돼 컬럼으로 잘못 렌더된다.
export function isBranchStarter(node) {
  if (node?.action === "errorHandlerTry") return true;
  if (node?.package === "If") {
    const a = (node.action || "").toLowerCase();
    return a.includes("if") && !a.includes("else"); // 원초 If만 — Else If/Else는 앞 If에 이어붙는다
  }
  return false;
}

// 분기 컬럼의 역할 라벨 — Error handler는 Try/Catch/Finally/Throw, If 패키지는 If/Else If/Else.
// 각 컬럼이 어떤 컨테이너 섹션인지 화면에 명시한다(액션 라벨만으론 Try/Catch/Finally 구분이 안 됨).
const _BRANCH_ROLE = {
  errorHandlerTry: "Try",
  errorHandlerCatch: "Catch",
  errorHandlerFinally: "Finally",
  errorHandlerThrow: "Throw",
};
export function branchRole(node) {
  if (!node) return null;
  if (_BRANCH_ROLE[node.action]) return _BRANCH_ROLE[node.action];
  if (node.package === "If") {
    const a = (node.action || "").toLowerCase();
    if (a.includes("elseif") || a.includes("else_if")) return "Else If";
    if (a.includes("else")) return "Else";
    if (a.includes("if")) return "If";
  }
  return null;
}

// A360 실행 의미상 이 분기 컬럼이 블록을 빠져나가 '다음 액션(또는 완료 end 노드)'으로 이어지는지.
//  · Error handler: Try/Catch는 Finally로 합류하고, Finally만 다음/end로 이어진다(Finally가 있을 때).
//    Finally가 없으면 Try/Catch가 유일한 출구라 예외적으로 이어지는 것으로 본다.
//  · If/Else·Else If 등 그 외 분기: 모든 컬럼이 다음/end로 이어진다.
export function branchColumnExits(pkg, node, cols) {
  if (pkg === "Error handler") {
    const hasFinally = (cols ?? []).some((c) => c?.node?.action === "errorHandlerFinally");
    return hasFinally ? node?.action === "errorHandlerFinally" : true;
  }
  return true;
}

// 분기 블록 라벨 — 패키지별로 사람이 읽는 이름(단독 Try여도 '분기'가 아니라 '예외 처리').
// 읽기 전용 렌더러(FlowSequence)와 Vue Flow 편집 캔버스(flowLayout)가 공유.
export function branchLabel(pkg) {
  if (pkg === "Error handler") return "예외 처리";
  if (pkg === "If") return "조건 분기";
  return `분기 · ${pkg}`;
}

// items(형제 액션 목록)를 "분기 그룹"과 "일반 노드"로 세그먼트화한다 — 연속한 분기 노드
// (Try/Catch/Finally, If/Else 계열) 2개 이상은 하나의 branch 세그먼트로 묶이고, 그 외는
// 각각 독립된 node 세그먼트다. 읽기 전용 렌더러(FlowSequence)와 Vue Flow 편집 캔버스
// (flowLayout)가 이 함수 하나를 공유해야 "분기 세트는 항상 하나의 이동 단위"라는 규칙이
// 두 화면에서 어긋나지 않는다.
export function buildSegments(items) {
  const raw = [];
  let cur = null; // 진행 중인 분기 그룹
  for (const item of items ?? []) {
    if (isBranchNode(item.node)) {
      const starter = isBranchStarter(item.node); // Try는 새 그룹 시작
      if (cur && cur.pkg === item.node.package && !starter) {
        cur.items.push(item); // Catch/Finally/Else — 앞 분기의 다른 열
      } else {
        if (cur) raw.push(cur);
        cur = { type: "branch", pkg: item.node.package, items: [item] };
      }
    } else {
      if (cur) {
        raw.push(cur);
        cur = null;
      }
      raw.push({ type: "node", item });
    }
  }
  if (cur) raw.push(cur);
  return raw.map((s) => ({ ...s, key: s.type === "branch" ? s.items[0].path : s.item.path }));
}

// 컨테이너 노드의 children을 트리 렌더용 항목으로 — 부모 번호/경로를 이어 계층 번호를 만든다.
// 예) 부모 prefix "4", path "actions[0]" → 자식 "4.1"/"actions[0].children[0]", "4.2"/...
export function childItems(prefix, path, children) {
  return (children ?? []).map((c, i) => ({
    node: c,
    prefix: `${prefix}.${i + 1}`,
    path: `${path}.children[${i}]`,
  }));
}

// 검수 위반 목록을 step_id → 그 스텝의 위반 location Set으로 묶는다 — FlowNode가 자기 path로
// 조회해 노드 강조 여부를 판단한다(스트리밍 중 검수 위반 노드 하이라이트).
export function violationSetByStep(violations) {
  const map = new Map();
  (violations ?? []).forEach((v) => {
    if (!v?.step_id || !v?.location) return;
    if (!map.has(v.step_id)) map.set(v.step_id, new Set());
    map.get(v.step_id).add(v.location);
  });
  return map;
}

// 파라미터 값 표시 폴백: null/undefined/빈 문자열이면 "(미지정)".
export function formatParamValue(value) {
  if (value === null || value === undefined || value === "") return t("common.unspecifiedParen");
  return value;
}
