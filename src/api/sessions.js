import { apiRequest } from "./http";

// POST /api/sessions — 문서 없이 빈 세션만 생성한다 (멀티턴 챗을 문서 업로드 없이 시작할 때 사용)
export function createSession() {
  return apiRequest("/api/sessions", { method: "POST" });
}
