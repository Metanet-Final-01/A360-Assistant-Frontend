import { t } from "../i18n";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const TOKEN_KEY = "a360_access_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(accessToken) {
  localStorage.setItem(TOKEN_KEY, accessToken);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// 백엔드는 4xx/5xx 응답에서 detail: {code, message} 형태로 내려준다 (API_명세.md 참고)
// 모든 응답엔 X-Request-ID 헤더가 붙는다 — 에러 문의 시 서버 로그 추적용으로 함께 들고 다닌다.
export class ApiError extends Error {
  constructor(code, message, status, requestId, detail = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId ?? null;
    // 서버가 detail에 실어 보낸 **구조화된 부가 정보** — code·message만 남기면 버려진다.
    // 예: 409 REFINE_IN_PROGRESS는 cancel_path(탈출구 경로)와 refine(진행 상태)을 함께
    // 주는데, 그걸 잃으면 프론트가 "정밀화 중입니다"만 띄우고 중단 버튼을 못 그린다
    // — 사유 없는 거절은 잠금이 아니라 고장으로 보인다(백엔드 _assert_not_refining 주석).
    this.detail = detail;
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
    return new ApiError(detail.code ?? "UNKNOWN", message, response.status, requestId, detail);
  }
  return new ApiError(
    "UNKNOWN",
    typeof detail === "string" ? detail : response.statusText,
    response.status,
    requestId,
  );
}

// 401(갱신도 실패한 최종 만료/무효) 공통 처리 — 토큰을 지우고 등록된 핸들러(auth 스토어의
// 강제 로그아웃)를 부른다. 핸들러 등록은 auth 스토어 생성 시점에 이뤄진다 (http.js가 스토어를
// 직접 import하면 순환 참조가 되므로 콜백 주입 방식). 언제 부를지(즉시 vs UI 갱신 후)는
// 호출부마다 달라 여기서 강제하지 않는다 — fetchWithAuth는 갱신·재시도만 하고 최종 401 여부만
// 응답으로 돌려준다.
let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized() {
  clearToken();
  unauthorizedHandler?.();
}

// 로그인/가입/갱신은 만료된 액세스 토큰으로 재시도할 대상이 아니다(로그인·가입은 토큰 자체가
// 없고, 갱신은 자기 자신을 갱신할 수 없다). 로그아웃은 베스트 에포트 호출이라 재시도해봐야
// 의미가 없어 함께 제외한다.
function isAuthNoRetryPath(path) {
  return (
    path.startsWith("/api/auth/login") ||
    path.startsWith("/api/auth/register") ||
    path.startsWith("/api/auth/refresh") ||
    path.startsWith("/api/auth/logout")
  );
}

function rawFetch(url, options, token) {
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  // 리프레시 토큰은 httpOnly 쿠키로 발급된다(RPA-216/205) — credentials: "include"가 있어야
  // 브라우저가 그 쿠키를 요청에 실어 보내고, 응답의 Set-Cookie(회전된 새 값)도 받아들인다.
  // 쿠키 자체는 Path=/api/auth로 범위가 좁혀져 있어 다른 엔드포인트로는 전송되지 않는다.
  return fetch(url, { ...options, headers, credentials: "include" });
}

// 리프레시 토큰은 1회용(회전)이라 갱신마다 새 토큰이 나오고 옛 토큰은 즉시 무효가 된다.
// 동시에 여러 요청이 401을 받아도 갱신 호출은 하나만 나가야 하므로(single-flight), 진행
// 중인 갱신이 있으면 그 프라미스를 공유해서 기다린다. 성공 시 새 토큰 쌍으로 즉시 교체해
// 옛 리프레시 토큰이 재사용되는 일이 없게 한다.
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh() {
  // 리프레시 토큰은 httpOnly 쿠키라 여기서 값을 읽거나 실어 보낼 수 없다(RPA-205) — 쿠키가
  // 없거나 무효면 서버가 401을 돌려줄 뿐이라 미리 존재 여부를 확인할 방법도, 필요도 없다.
  const tokenAtStart = getToken(); // 요청 시작 시점의 세션 식별값(Qodo 리뷰) — 완료 후 비교용
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include", // httpOnly 쿠키 전송 + 회전된 새 쿠키(Set-Cookie) 수신
      signal: AbortSignal.timeout(10000), // 갱신 응답이 멈추면 single-flight를 기다리는 모든 요청이 함께 걸린다
    });
  } catch {
    return null; // 네트워크 오류·타임아웃 — 갱신 실패로 취급하고 원 요청의 401을 그대로 호출부에 넘긴다
  }
  if (!response.ok) return null; // INVALID_REFRESH_TOKEN 등 — 재로그인 필요

  const data = await response.json();
  // 갱신이 진행되는 동안 로그아웃하거나(→ null) 다른 세션으로 재로그인했으면(→ 다른 토큰)
  // 이 응답은 낡은 것이다 — 그대로 저장하면 이미 끝난 세션이 되살아나거나 새 세션의 토큰을
  // 덮어쓴다. 리프레시 토큰은 쿠키라 직접 비교할 수 없어, 시작 시점 액세스 토큰과 지금 값이
  // 같은지로 판단한다. 값이 바뀌었으면 현재 토큰을 그대로 반환할 뿐 저장은 하지 않는다(호출자가
  // null이면 재인증, 값이 있으면 그 토큰으로 재시도).
  // tokenAtStart가 이미 null(로그아웃 상태)이면 tokenNow도 null이라 위 비교(null !== null)를
  // 그대로 통과해버린다(Qodo 리뷰) — 로그아웃된 세션이 갱신 응답만으로 되살아나지 않도록
  // 시작 시점에 로그인 상태가 아니었으면 무조건 갱신을 버린다.
  if (tokenAtStart == null) return null;
  const tokenNow = getToken();
  if (tokenNow !== tokenAtStart) return tokenNow;
  setToken(data.access_token);
  return data.access_token;
}

// 401을 받으면 갱신 후 원 요청을 1회 재시도한다 — REST(apiRequest)와 SSE(agent/documents/
// recommend의 raw fetch) 공통 진입점. 갱신이 실패하거나 재시도도 401이면 그 응답을 그대로
// 돌려준다: 로그아웃(notifyUnauthorized) 호출 여부·시점은 호출부에 맡긴다(예: 스트리밍 쪽은
// 에러 메시지를 UI에 먼저 반영한 뒤 로그아웃해야 하는 순서 제약이 있다).
export async function fetchWithAuth(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  let response = await rawFetch(url, options, getToken());

  if (response.status === 401 && !isAuthNoRetryPath(path)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await rawFetch(url, options, newToken);
    }
  }
  return response;
}

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetchWithAuth(path, options);
  } catch (err) {
    // signal로 의도적으로 취소된 요청 — 네트워크 장애가 아니므로 그대로 던져
    // 호출부가 AbortError로 구분해 조용히 처리하게 한다.
    if (err?.name === "AbortError") throw err;
    throw new ApiError("NETWORK_ERROR", t("api.errors.networkUnreachable"), 0);
  }

  // 갱신까지 시도했는데도 여전히 401이면 세션을 되살릴 수 없다는 뜻 — 로그인 화면으로.
  // 로그인/가입 자체의 401은 "자격 증명 오류"라 세션 만료 처리 대상이 아니다.
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    notifyUnauthorized();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) return null;
  return response.json();
}
