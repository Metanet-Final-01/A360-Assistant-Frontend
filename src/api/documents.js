import { apiRequest, getToken, notifyUnauthorized } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// POST /api/documents — 업무정의서 업로드. 검증·저장만 하고 즉시 반환한다 (status="uploaded").
// 파싱은 분리되어 있어 이어서 parseDocument()로 진행해야 status가 "parsed"로 바뀐다.
export function uploadDocument(file, sessionId) {
  const formData = new FormData();
  formData.append("file", file);
  if (sessionId) formData.append("session_id", sessionId);
  return apiRequest("/api/documents", { method: "POST", body: formData });
}

// POST /api/documents/{id}/parse — 업로드된 문서 파싱 진행. SSE(fetch 스트리밍): stage → done/error.
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
    onError("백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
    return;
  }

  if (response.status === 401) {
    try {
      onError("로그인이 만료되었습니다. 다시 로그인해주세요.");
    } finally {
      notifyUnauthorized(); // 토큰 만료 — 로그인 화면으로 (apiRequest의 401 처리와 동일). resetUpload()가
      // 업로드 상태의 마지막 갱신이어야 하므로 onError보다 뒤에 실행한다 — 순서를 바꾸면
      // resetUpload()가 지운 uploadStatus/uploadError를 onError가 다시 "error"로 덮어써 버린다.
    }
    return;
  }
  if (!response.ok || !response.body) {
    onError("문서 파싱 요청에 실패했습니다.");
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
        else if (event.event === "error") onError(event.message ?? "문서 파싱에 실패했습니다.");
      }
    }
  } catch {
    onError("문서 파싱 중 연결이 끊어졌습니다. 다시 시도해주세요.");
  }
}

// POST /api/documents/text — 파일 없이 자연어 업무 요청으로 문서를 등록한다.
// 파싱이 필요 없어 status="parsed"로 바로 응답 — parseDocument() 호출 없이 곧장 분석 가능.
export function createDocumentFromText(text, sessionId) {
  return apiRequest("/api/documents/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, session_id: sessionId ?? null }),
  });
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
