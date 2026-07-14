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

// confidence(0~1)를 뱃지 등급+텍스트로 변환. null/undefined면 뱃지를 표시하지 않으므로 null 반환.
// 임계값: high >= 0.7, mid >= 0.4, 그 외 low.
export function confidenceBadge(confidence) {
  if (confidence == null) return null;
  const level = confidence >= 0.7 ? "high" : confidence >= 0.4 ? "mid" : "low";
  return {
    level,
    text: t("recommendation.confidenceBadge", {
      label: t(`recommendation.confidence.${level}`),
      percent: Math.round(confidence * 100),
    }),
  };
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

// 파라미터 값 표시 폴백: null/undefined/빈 문자열이면 "(미지정)".
export function formatParamValue(value) {
  if (value === null || value === undefined || value === "") return t("common.unspecifiedParen");
  return value;
}
