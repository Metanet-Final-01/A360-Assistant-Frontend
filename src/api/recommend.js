import { apiRequest, getToken, ApiError, notifyUnauthorized } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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

// GET /api/sessions/{id}/recommendations/{version}/export — 확정 추천안을 표준 봉투 JSON으로
// 다운로드한다 (FR-17, 골든셋 채점 포맷). 응답: { schema_version, session_id,
// recommendation_version, source, exported_at, recommendation } + Content-Disposition.
// 프론트 로컬 Blob 대신 이 응답 그대로를 파일로 저장해야 채점 포맷과 일치한다.
export async function downloadRecommendationExport(sessionId, version) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/recommendations/${version}/export`, { headers });
  } catch {
    throw new ApiError("NETWORK_ERROR", "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.", 0);
  }
  if (response.status === 401) {
    notifyUnauthorized(); // 토큰 만료 — 로그인 화면으로 (apiRequest의 401 처리와 동일)
  }
  if (!response.ok) {
    throw new ApiError("EXPORT_FAILED", "내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.", response.status);
  }

  // Content-Disposition의 파일명을 그대로 쓴다 (예: recommendation-{session}-v{n}.json)
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `recommendation-v${version}.json`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
