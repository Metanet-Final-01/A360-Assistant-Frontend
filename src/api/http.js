const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const TOKEN_KEY = "a360_access_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// 백엔드는 4xx/5xx 응답에서 detail: {code, message} 형태로 내려준다 (API_명세.md 참고)
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

// FastAPI가 요청 스키마 검증에 실패하면(422) {code,message}가 아니라 Pydantic 에러 배열을 내려준다:
// [{loc: ["body","email"], msg: "...", type: "..."}]. 필드별로 사람이 읽을 메시지로 바꾼다.
function describeValidationError(first) {
  const field = first?.loc?.at(-1);
  if (field === "email") return "올바른 이메일 형식이 아닙니다.";
  if (field === "password" && first?.type === "string_too_short") {
    return `비밀번호는 최소 ${first?.ctx?.min_length ?? 8}자 이상이어야 합니다.`;
  }
  return first?.msg ?? "입력값을 확인해주세요.";
}

async function toApiError(response) {
  let detail = null;
  try {
    const body = await response.json();
    detail = body?.detail;
  } catch {
    // 응답 본문이 JSON이 아닌 경우 무시
  }

  if (Array.isArray(detail)) {
    return new ApiError("VALIDATION_ERROR", describeValidationError(detail[0]), response.status);
  }
  if (detail && typeof detail === "object") {
    return new ApiError(detail.code ?? "UNKNOWN", detail.message ?? response.statusText, response.status);
  }
  return new ApiError("UNKNOWN", typeof detail === "string" ? detail : response.statusText, response.status);
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError("NETWORK_ERROR", "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.", 0);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) return null;
  return response.json();
}
