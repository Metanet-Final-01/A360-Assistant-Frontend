import { apiRequest } from "./http";

// POST /api/documents — 업무정의서 업로드 (검증 → 저장 → 파싱까지 동기 처리)
export function uploadDocument(file, sessionId) {
  const formData = new FormData();
  formData.append("file", file);
  if (sessionId) formData.append("session_id", sessionId);
  return apiRequest("/api/documents", { method: "POST", body: formData });
}

// GET /api/documents/{id} — 문서 메타데이터/상태 재조회
export function getDocument(documentId) {
  return apiRequest(`/api/documents/${documentId}`);
}

// GET /api/documents/{id}/content — 파싱된 구조화 결과
export function getDocumentContent(documentId) {
  return apiRequest(`/api/documents/${documentId}/content`);
}

// POST /api/documents/{id}/enrich-vision — 비전 LLM 보강 (2-1, 병합 후 사용 가능)
export function enrichVision(documentId) {
  return apiRequest(`/api/documents/${documentId}/enrich-vision`, { method: "POST" });
}
