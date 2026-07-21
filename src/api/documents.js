import { apiRequest, fetchWithAuth, notifyUnauthorized } from "./http";
import { t } from "../i18n";

// POST /api/documents — 업무정의서 업로드. 검증·저장만 하고 즉시 반환한다 (status="uploaded").
// 파싱은 분리되어 있어 이어서 parseDocument()로 진행해야 status가 "parsed"로 바뀐다.
export function uploadDocument(file, sessionId, { signal } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (sessionId) formData.append("session_id", sessionId);
  return apiRequest("/api/documents", { method: "POST", body: formData, signal });
}

// POST /api/documents/{id}/parse — 업로드된 문서 파싱 진행. SSE(fetch 스트리밍): stage → done/error.
export async function parseDocument(documentId, { onStage, onDone, onError, signal }) {
  let response;
  try {
    response = await fetchWithAuth(`/api/documents/${documentId}/parse`, {
      method: "POST",
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return; // 새 업로드/초기화로 의도적으로 취소됨 — 에러 아님
    onError(t("api.errors.networkUnreachable"));
    return;
  }

  if (response.status === 401) {
    try {
      onError(t("api.errors.sessionExpired"));
    } finally {
      notifyUnauthorized(); // 토큰 만료 — 로그인 화면으로 (apiRequest의 401 처리와 동일). resetUpload()가
      // 업로드 상태의 마지막 갱신이어야 하므로 onError보다 뒤에 실행한다 — 순서를 바꾸면
      // resetUpload()가 지운 uploadStatus/uploadError를 onError가 다시 "error"로 덮어써 버린다.
    }
    return;
  }
  if (!response.ok || !response.body) {
    onError(t("api.errors.parseRequestFailed"));
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
        else if (event.event === "error") onError(event.message ?? t("api.errors.parseFailed"));
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // 새 업로드/초기화로 의도적으로 취소됨 — 에러 아님
    onError(t("api.errors.parseStreamDisconnected"));
  }
}

// POST /api/documents/text — 파일 없이 자연어 업무 요청으로 문서를 등록한다.
// 파싱이 필요 없어 status="parsed"로 바로 응답 — parseDocument() 호출 없이 곧장 분석 가능.
export function createDocumentFromText(text, sessionId, { signal } = {}) {
  return apiRequest("/api/documents/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, session_id: sessionId ?? null }),
    signal,
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

// POST /api/documents/{id}/enrich-vision — 텍스트가 부족한 페이지를 비전 LLM으로 보강 (FR-03).
// parseDocument()와 동일하게 SSE(fetch 스트리밍): stage → done(data = 문서 요약 + enriched_pages)
// /error. REST apiRequest로는 소비할 수 없다(백엔드가 text/event-stream을 반환).
export async function enrichVision(documentId, { onStage, onDone, onError, signal }) {
  let response;
  try {
    response = await fetchWithAuth(`/api/documents/${documentId}/enrich-vision`, {
      method: "POST",
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return;
    onError(t("api.errors.networkUnreachable"));
    return;
  }

  if (response.status === 401) {
    try {
      onError(t("api.errors.sessionExpired"));
    } finally {
      notifyUnauthorized();
    }
    return;
  }
  if (!response.ok || !response.body) {
    onError(t("api.errors.parseRequestFailed"));
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // 백엔드가 항상 done/error로 끝나야 하지만, 프록시 타임아웃이나 서버 크래시로 스트림이
  // 중간에 끊기면(done/error 없이 EOF) sawTerminal이 false로 남아 아래에서 잡아낸다 —
  // 그렇지 않으면 visionStatus가 'enriching'에 멈춰 스피너가 영원히 돈다.
  let sawTerminal = false;

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
        else if (event.event === "done") {
          sawTerminal = true;
          onDone(event.data);
        } else if (event.event === "error") {
          sawTerminal = true;
          onError(event.message ?? t("api.errors.parseFailed"));
        }
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    onError(t("api.errors.parseStreamDisconnected"));
    return;
  }

  if (!sawTerminal) onError(t("api.errors.parseStreamDisconnected"));
}
