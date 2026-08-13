import { apiRequest } from "./http";

// POST /api/sessions — 문서 없이 빈 세션만 생성한다 (멀티턴 챗을 문서 업로드 없이 시작할 때 사용)
export function createSession() {
  return apiRequest("/api/sessions", { method: "POST" });
}

// GET /api/sessions — 로그인 사용자의 세션 목록(최신 활동순). Bearer 필수(미인증 401).
// 응답: { sessions: [{ id, title, solution, created_at, updated_at }] }
export function listSessions() {
  return apiRequest("/api/sessions");
}

// PATCH /api/sessions/{id} — 세션 부분 수정. 지금은 solution만 (RPA-286).
// 타 솔루션 모드는 대화에서 카탈로그가 확인되면 백엔드가 자동 확정한다 — 마찰이 없는 대신
// 오탐 가능성이 있어, 사용자가 "a360"으로 되돌릴 수 있어야 한다. 응답: 갱신된 세션 객체.
export function patchSession(sessionId, patch) {
  return apiRequest(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// DELETE /api/sessions/{id} — 세션 삭제 (문서/분석/추천/대화가 CASCADE로 함께 삭제) → 204
export function deleteSession(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

// GET /api/sessions/{id}/chat-messages — 대화 이력(시간순).
// 응답: { messages: [{ id, role, content, recommendation_version, created_at }] }
export function listChatMessages(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/chat-messages`);
}

// GET /api/sessions/{id}/analyses/latest — 최신 완료 분석의 전체 result.
// 404 NO_ANALYSIS: 완료된 분석 없음. 응답: { ..., result: AnalysisResult }
export function getLatestAnalysis(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/analyses/latest`);
}

// GET /api/sessions/{id}/usage-gauge — 세션의 대화 누적 토큰 게이지(재조회용, RPA-379).
// /turn done.data.usage_gauge와 동일한 셰이프. 세션 이력 하이드레이션(loadSession) 시
// 게이지를 복원하는 용도 — 아직 턴을 한 번도 안 밟은 세션은 404 NO_USAGE.
// 응답: { intake_tokens, limit_tokens, ratio, compact_recommended, compact_required }
export function getUsageGauge(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/usage-gauge`);
}
