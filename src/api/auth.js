import { apiRequest } from "./http";

// POST /api/auth/register — 201 { access_token, token_type }. 이메일 중복 409, 비번 8자 미만 422.
// 리프레시 토큰은 응답 바디가 아니라 httpOnly 쿠키(Set-Cookie)로 내려온다(RPA-216/205) —
// 페이지 JS가 값을 읽을 수 없어 XSS로 탈취돼도 노출되지 않는다. apiRequest가 credentials:
// "include"로 요청하므로 쿠키는 브라우저가 자동으로 저장·전송한다(별도 처리 불필요).
export function register(email, password) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// POST /api/auth/login — 200 { access_token, token_type }. 실패 401 INVALID_CREDENTIALS.
// 리프레시 토큰은 register와 동일하게 httpOnly 쿠키로 온다.
export function login(email, password) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// GET /api/auth/me — Authorization 헤더는 apiRequest가 저장된 토큰으로 자동 첨부한다.
export function getMe() {
  return apiRequest("/api/auth/me");
}

// POST /api/auth/logout — 204(멱등, 이미 폐기된 리프레시 토큰이어도 204). 서버 쪽 세션을 실제로
// 끊는다 — 호출하지 않으면 로컬에서 액세스 토큰을 지워도 서버엔 리프레시 토큰이 살아있다.
// 쿠키는 credentials: "include"로 자동 첨부되므로 body에 실어 보낼 필요가 없다(RPA-205).
export function logout() {
  return apiRequest("/api/auth/logout", { method: "POST" });
}
