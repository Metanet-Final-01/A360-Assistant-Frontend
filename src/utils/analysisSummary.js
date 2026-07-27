// 분석 결과(WorkStep[], schemas/analysis.py)에서 화면용 파생 데이터를 뽑는 순수 함수들.
// 업로드 패널의 "분석 요약" 통계와 분석 패널의 시스템·입출력·근거 탭이 같은 원본을 서로
// 다른 각도로 보여주므로, 집계 규칙(중복 제거·빈 값 무시·등장 순서 유지)을 여기 한 곳에 둔다.

// 여러 단계에 흩어진 값을 "처음 등장한 순서를 유지한 채" 중복 없이 모은다.
// Set은 삽입 순서를 보존하므로 정렬을 따로 하지 않는다 — 문서에 나온 순서가 곧
// 사용자가 기대하는 순서다(가나다순으로 흐트러뜨리면 흐름과 어긋난다).
function collectUnique(steps, key) {
  const seen = new Set();
  for (const step of steps ?? []) {
    for (const raw of step?.[key] ?? []) {
      const value = typeof raw === "string" ? raw.trim() : raw;
      if (value) seen.add(value);
    }
  }
  return [...seen];
}

// 항목(시스템/입력/출력) → 그 항목이 등장하는 단계 목록. 시스템 카드와 입출력 탭이
// "이 시스템은 어느 단계에서 쓰이나"를 함께 보여주는 데 쓴다.
function groupByItem(steps, key) {
  const map = new Map();
  (steps ?? []).forEach((step, idx) => {
    for (const raw of step?.[key] ?? []) {
      const value = typeof raw === "string" ? raw.trim() : raw;
      if (!value) continue;
      if (!map.has(value)) map.set(value, []);
      map.get(value).push({ order: step.order ?? idx + 1, name: step.name ?? "" });
    }
  });
  return [...map].map(([name, usedIn]) => ({ name, usedIn }));
}

export function analysisStats(steps) {
  return {
    stepCount: (steps ?? []).length,
    systemCount: collectUnique(steps, "systems").length,
    inputCount: collectUnique(steps, "inputs").length,
    outputCount: collectUnique(steps, "outputs").length,
  };
}

export function systemUsage(steps) {
  return groupByItem(steps, "systems");
}

export function ioUsage(steps) {
  return {
    inputs: groupByItem(steps, "inputs"),
    outputs: groupByItem(steps, "outputs"),
  };
}

// 원문 근거가 실제로 달려 있는 단계만 — 근거 없는 단계까지 빈 줄로 나열하면
// "근거가 없다"는 사실이 오히려 안 보인다(탭 자체를 비활성화하는 판단에도 쓴다).
export function evidenceItems(steps) {
  return (steps ?? [])
    .map((step, idx) => ({
      order: step.order ?? idx + 1,
      name: step.name ?? "",
      page: step.evidence?.page ?? null,
      snippet: step.evidence?.snippet ?? "",
    }))
    .filter((item) => item.page != null || item.snippet);
}
