import { apiRequest, fetchWithAuth, ApiError, notifyUnauthorized } from "./http";
import { t } from "../i18n";
import { triggerBlobDownload } from "../utils/download";

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
  let response;
  try {
    response = await fetchWithAuth(`/api/sessions/${sessionId}/recommendations/${version}/export`);
  } catch {
    throw new ApiError("NETWORK_ERROR", t("api.errors.networkUnreachable"), 0);
  }
  if (response.status === 401) {
    notifyUnauthorized(); // 토큰 만료 — 로그인 화면으로 (apiRequest의 401 처리와 동일)
  }
  if (!response.ok) {
    throw new ApiError("EXPORT_FAILED", t("api.errors.exportFailed"), response.status);
  }

  // Content-Disposition의 파일명을 그대로 쓴다 (예: recommendation-{session}-v{n}.json)
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `recommendation-v${version}.json`;
  const blob = await response.blob();
  triggerBlobDownload(blob, filename);
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

// GET /api/sessions/{id}/refine — 이 세션이 정밀화로 잠겨 있는지 (설계 §6.3)
//
// SSE partial(kind="refine")을 **놓친** 클라이언트가 물어볼 곳이다. 새로고침·재접속하면
// 스트림이 끊겨 잠금 상태를 알 수 없는데, 그때 편집 UI를 열어 두면 사용자가 저장을
// 눌렀다가 409를 맞는다. 세션을 열 때 한 번 물어 UI 상태를 복원한다.
//
// 반환: { locked, refine: {status, draft_id, elapsed_ms, ...} | null, last: {...} | null }
// last에는 **마지막 정밀화 결과**가 잠시 남는다 — 완료 직후 locked=false만 보면
// 정상 완료인지 중단·타임아웃인지 구분할 수 없다.
export function getRefineStatus(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/refine`);
}

// POST /api/sessions/{id}/refine/cancel — 탈출구: "정밀화 중단하고 지금 초안으로 수정하기"
//
// 잠금만 있고 탈출구가 없으면 사용자는 갇힌 느낌을 받는다(설계 §6.3). 중단해도 초안은
// 그대로 확정본이 되므로 잃는 것은 '더 다듬어진 결과'뿐이다.
export function cancelRefine(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/refine/cancel`, { method: "POST" });
}
