import { apiRequest } from "./http";

// NOTE: 흐름도 생성(POST /api/sessions/{id}/recommend)은 레거시로 제거됐다 (RPA-67) —
// 생성은 POST /api/sessions/{id}/turn(api/agent.js turnStream)에 합성 메시지를 보내는
// 방식으로 바뀌었다. 아래 버전 저장·조회 REST는 그대로 유지된다.

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
