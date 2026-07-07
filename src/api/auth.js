import { apiRequest } from "./http";

// POST /api/auth/register — 201 { access_token, token_type }. 이메일 중복 409, 비번 8자 미만 422.
export function register(email, password) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// POST /api/auth/login — 200 { access_token, token_type }. 실패 401 INVALID_CREDENTIALS.
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
