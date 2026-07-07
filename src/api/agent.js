import { apiRequest, getToken } from "./http";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// POST /api/agent/chat — 비스트리밍 질의응답 (한 번에 답 + sources)
export function chatOnce(message) {
  return apiRequest("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

// POST /api/agent/chat/stream — SSE(fetch 스트리밍). event 필드로 token/done/error 분기.
// sources는 스트림에 실리지 않는다 (필요하면 chatOnce 사용).
export async function chatStream(message, { onToken, onDone, onError }) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/agent/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });
  } catch {
    onError("백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
    return;
  }

  if (!response.ok || !response.body) {
    onError("챗봇 응답을 받아오지 못했습니다.");
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

        if (event.event === "token") onToken(event.message ?? "");
        else if (event.event === "done") onDone();
        else if (event.event === "error") onError(event.message ?? "알 수 없는 오류가 발생했습니다.");
      }
    }
  } catch {
    // 서버가 정상 error 이벤트 없이 스트림을 중간에 끊는 경우 (예: 백엔드 미처리 예외)
    onError("응답을 받는 중 연결이 끊어졌습니다. 다시 시도해주세요.");
  }
}
