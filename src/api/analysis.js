import { getToken } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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

// POST /api/sessions/{id}/analyze — SSE(fetch 스트리밍). event 필드로 stage/done/error 분기.
// onError(code, message): HTTP 레벨 에러는 detail.code(예: AGENT_UNAVAILABLE)를 그대로 전달하고,
// 스트림 중간의 error 이벤트는 서버가 code를 안 주므로 null로 전달한다.
export async function analyzeSession(sessionId, { onStage, onDone, onError }) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/analyze`, {
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
    onError("UNKNOWN", "분석 응답을 받아오지 못했습니다.");
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
        else if (event.event === "error") onError(null, event.message ?? "분석 중 오류가 발생했습니다.");
      }
    }
  } catch {
    onError(null, "분석 중 연결이 끊어졌습니다. 다시 시도해주세요.");
  }
}
