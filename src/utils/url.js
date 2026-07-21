// 백엔드(RAG/LLM)가 내려주는 출처 URL은 신뢰할 수 없다 — javascript:/data: 등
// active scheme을 href에 그대로 꽂으면 클릭 시 앱 origin에서 스크립트가 실행될 수 있다(XSS).
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function safeExternalHref(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}
