// RecommendedAction 트리(schemas/recommendation.py) 공용 헬퍼 — 액션+패키지만 필요한
// 화면(분석 결과 카드, 흐름도 보기 모달)에서 같은 방식으로 펼치고 같은 색을 쓰도록 공유한다.

const PALETTE = ["#1f6f8b", "#7c5cbf", "#b7791f", "#1f9d55", "#d84a3a", "#2f6fa8", "#a8447a", "#55607a"];

// Loop/If 같은 컨테이너 액션의 children까지 재귀적으로 펼쳐 순서대로 나열한다.
export function flattenActions(actions) {
  const result = [];
  function walk(list) {
    (list ?? []).forEach((a) => {
      result.push({ label: a.label || a.action, package: a.package || "미지정", confidence: a.confidence });
      if (a.children?.length) walk(a.children);
    });
  }
  walk(actions);
  return result;
}

const CONFIDENCE_LABEL = { high: "높음", mid: "보통", low: "낮음" };

// confidence(0~1)를 뱃지 등급+텍스트로 변환. null/undefined면 뱃지를 표시하지 않으므로 null 반환.
// 임계값: high >= 0.7, mid >= 0.4, 그 외 low.
export function confidenceBadge(confidence) {
  if (confidence == null) return null;
  const level = confidence >= 0.7 ? "high" : confidence >= 0.4 ? "mid" : "low";
  return { level, text: `${CONFIDENCE_LABEL[level]} ${Math.round(confidence * 100)}%` };
}

// 패키지별 색상은 고정된 의미 매핑이 아니라, steps를 훑으면서 처음 등장한 순서대로 팔레트를 배정한다.
// steps 순서가 같으면 두 화면에서 같은 패키지가 항상 같은 색으로 보인다.
export function buildPackageColorMap(steps) {
  const map = new Map();
  function walk(actions) {
    (actions ?? []).forEach((a) => {
      const key = a.package || "미지정";
      if (!map.has(key)) map.set(key, PALETTE[map.size % PALETTE.length]);
      if (a.children?.length) walk(a.children);
    });
  }
  (steps ?? []).forEach((stepRec) => walk(stepRec.actions));
  return map;
}
