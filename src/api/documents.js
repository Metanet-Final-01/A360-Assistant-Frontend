import { apiRequest, getToken } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// POST /api/documents — 업무정의서 업로드. 검증·저장만 하고 status="uploaded"로 즉시 반환한다
// (백엔드 계약: 파싱은 분리되어 있어, 이어서 parseDocument()로 소비해야 status가 "parsed"가 된다).
export function uploadDocument(file, sessionId) {
  const formData = new FormData();
  formData.append("file", file);
  if (sessionId) formData.append("session_id", sessionId);
  return apiRequest("/api/documents", { method: "POST", body: formData });
}

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      return { code: detail.code ?? "UNKNOWN", message: detail.message ?? response.statusText };
    }
  } catch {
    // 본문이 JSON이 아니거나 detail이 없는 경우
  }
  return { code: "UNKNOWN", message: response.statusText };
}

// POST /api/documents/{id}/parse — SSE(fetch 스트리밍). event 필드로 stage/done/error 분기.
// analyzeSession()과 동일한 프레이밍(analysis.js 참고).
export async function parseDocument(documentId, { onStage, onDone, onError }) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/documents/${documentId}/parse`, {
      method: "POST",
      headers,
    });
  } catch {
    onError("NETWORK_ERROR", "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
    return;
  }

  if (!response.ok) {
    const { code, message } = await readErrorDetail(response);
    onError(code, message);
    return;
  }
  if (!response.body) {
    onError("UNKNOWN", "파싱 응답을 받아오지 못했습니다.");
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        let event;
        try {
          event = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }

        if (event.event === "stage") onStage?.(event.message ?? "");
        else if (event.event === "done") onDone(event.data);
        else if (event.event === "error") onError(null, event.message ?? "문서 파싱 중 오류가 발생했습니다.");
      }
    }
  } catch {
    onError(null, "파싱 중 연결이 끊어졌습니다. 다시 시도해주세요.");
  }
}

// GET /api/documents/{id} — 문서 메타데이터/상태 재조회
export function getDocument(documentId) {
  return apiRequest(`/api/documents/${documentId}`);
}

// GET /api/documents/{id}/content — 파싱된 구조화 결과
export function getDocumentContent(documentId) {
  return apiRequest(`/api/documents/${documentId}/content`);
}

// POST /api/documents/{id}/enrich-vision — 비전 LLM 보강 (2-1, 병합 후 사용 가능)
export function enrichVision(documentId) {
  return apiRequest(`/api/documents/${documentId}/enrich-vision`, { method: "POST" });
}
