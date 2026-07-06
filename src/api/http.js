const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// 백엔드는 4xx/5xx 응답에서 detail: {code, message} 형태로 내려준다 (API_명세.md 참고)
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function toApiError(response) {
  let detail = null;
  try {
    const body = await response.json();
    detail = body?.detail;
  } catch {
    // 응답 본문이 JSON이 아닌 경우 무시
  }

  if (detail && typeof detail === "object") {
    return new ApiError(detail.code ?? "UNKNOWN", detail.message ?? response.statusText, response.status);
  }
  return new ApiError("UNKNOWN", typeof detail === "string" ? detail : response.statusText, response.status);
}

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, options);
  } catch {
    throw new ApiError("NETWORK_ERROR", "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.", 0);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) return null;
  return response.json();
}
