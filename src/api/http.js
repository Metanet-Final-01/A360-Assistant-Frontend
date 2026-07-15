import { t } from "../i18n";

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
// 모든 응답엔 X-Request-ID 헤더가 붙는다 — 에러 문의 시 서버 로그 추적용으로 함께 들고 다닌다.
export class ApiError extends Error {
  constructor(code, message, status, requestId) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId ?? null;
  }
}

// FastAPI가 요청 스키마 검증에 실패하면(422) {code,message}가 아니라 Pydantic 에러 배열을 내려준다:
// [{loc: ["body","email"], msg: "...", type: "..."}]. 필드별로 사람이 읽을 메시지로 바꾼다.
function describeValidationError(first) {
  const field = first?.loc?.at(-1);
  if (field === "email") return t("api.errors.invalidEmail");
  if (field === "password" && first?.type === "string_too_short") {
    return t("api.errors.passwordTooShort", { min: first?.ctx?.min_length ?? 8 });
  }
  return first?.msg ?? t("api.errors.checkInput");
}

async function toApiError(response) {
  const requestId = response.headers.get("X-Request-ID");
  let detail = null;
  try {
    const body = await response.json();
    detail = body?.detail;
  } catch {
    // 응답 본문이 JSON이 아닌 경우 무시
  }

  if (Array.isArray(detail)) {
    return new ApiError("VALIDATION_ERROR", describeValidationError(detail[0]), response.status, requestId);
  }
  if (detail && typeof detail === "object") {
    let message = detail.message ?? response.statusText;
    // RPA-166: INVALID_RECOMMENDATION 등은 errors[]에 어느 필드가 왜 틀렸는지 실려 온다 —
    // "…올바르지 않습니다: 1건"처럼 개수만 있는 message에 첫 항목을 붙여 원인을 바로 보여준다.
    if (Array.isArray(detail.errors) && detail.errors.length) {
      const first = detail.errors[0];
      const firstText = [first?.field, first?.reason].filter(Boolean).join(": ");
      if (firstText) {
        const rest = detail.errors.length - 1;
        message += ` (${firstText}${rest > 0 ? ` +${rest}` : ""})`;
      }
    }
    return new ApiError(detail.code ?? "UNKNOWN", message, response.status, requestId);
  }
  return new ApiError(
    "UNKNOWN",
    typeof detail === "string" ? detail : response.statusText,
    response.status,
    requestId,
  );
}

// 401(토큰 만료/무효) 공통 처리 — 토큰을 지우고 등록된 핸들러(auth 스토어의 강제 로그아웃)를
// 부른다. 핸들러 등록은 auth 스토어 생성 시점에 이뤄진다 (http.js가 스토어를 직접 import하면
// 순환 참조가 되므로 콜백 주입 방식). SSE 경로(agent/documents)도 스트림 시작 전 401에서
// notifyUnauthorized()를 호출해 동일하게 처리한다.
let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized() {
  clearToken();
  unauthorizedHandler?.();
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (err) {
    // signal로 의도적으로 취소된 요청 — 네트워크 장애가 아니므로 그대로 던져
    // 호출부가 AbortError로 구분해 조용히 처리하게 한다.
    if (err?.name === "AbortError") throw err;
    throw new ApiError("NETWORK_ERROR", t("api.errors.networkUnreachable"), 0);
  }

  // 로그인/가입의 401은 "자격 증명 오류"라 세션 만료 처리 대상이 아니다
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    notifyUnauthorized();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) return null;
  return response.json();
}
