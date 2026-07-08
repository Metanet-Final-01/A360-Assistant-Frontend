import { apiRequest, getToken } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      return { code: detail.code ?? "UNKNOWN", message: detail.message ?? response.statusText };
    }
  } catch {
    // 본문이 JSON이 아니거나 detail이 없는 경우
  }
  return { code: "UNKNOWN", message: response.statusText };
}

// POST /api/sessions/{id}/recommend — 최신 분석으로 흐름도(Recommendation 트리)를 생성·v1 저장한다.
// SSE: stage/partial(진행) → done(data={id,version,...,recommendation}) / error.
// onPartial(stepId, actions): 단계 하나의 액션 시퀀스가 먼저 나올 때마다 호출 (점진 렌더링용).
export async function recommendSession(sessionId, { onStage, onPartial, onDone, onError }) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/recommend`, {
      method: "POST",
      headers,
    });
  } catch {
    onError("NETWORK_ERROR", "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
    return;
  }

  if (!response.ok) {
    const { code, message } = await readErrorDetail(response);
    onError(code, message);
    return;
  }
  if (!response.body) {
    onError("UNKNOWN", "추천안 응답을 받아오지 못했습니다.");
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        let event;
        try {
          event = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }

        if (event.event === "stage") onStage?.(event.message ?? "");
        else if (event.event === "partial") onPartial?.(event.data?.step_id, event.data?.actions);
        else if (event.event === "done") onDone(event.data);
        else if (event.event === "error") onError(null, event.message ?? "추천안 생성 중 오류가 발생했습니다.");
      }
    }
  } catch {
    onError(null, "추천안 생성 중 연결이 끊어졌습니다. 다시 시도해주세요.");
  }
}

// GET /api/sessions/{id}/recommendations/latest — 최신 추천안 트리 전체
export function getLatestRecommendation(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/recommendations/latest`);
}

// GET /api/sessions/{id}/recommendations — 버전 메타 목록(최신 순, 트리 내용은 없음)
export function listRecommendations(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/recommendations`);
}

// POST /api/sessions/{id}/recommendations — 편집된 트리를 새 버전으로 저장 (undo도 이걸로: 이전 트리를 다시 저장)
export function saveRecommendation(sessionId, { recommendation, parentVersion, source = "drag", changeSummary }) {
  return apiRequest(`/api/sessions/${sessionId}/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recommendation,
      parent_version: parentVersion ?? null,
      source,
      change_summary: changeSummary ?? null,
    }),
  });
}
