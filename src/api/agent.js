import { apiRequest, getToken, notifyUnauthorized } from "./http";
import { t } from "../i18n";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// GET /api/agent/versions — 선택 가능한 에이전트 버전 목록 (RPA-167).
// 응답: { versions: [{ id, label, description, default }], default: "v2" }
// 셀렉터 옵션은 반드시 이 응답으로 동적 구성한다 — v3가 추가돼도 프론트 수정이 없도록
// ["v1","v2"] 같은 하드코딩 금지. 실패 시 호출부(settings 스토어)가 셀렉터를 숨기고
// 요청에서 agent_version을 생략해 백엔드 기본 버전으로 동작한다.
export function getAgentVersions() {
  return apiRequest("/api/agent/versions");
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

// POST /api/sessions/{sessionId}/turn — 에이전트 단일 진입점 (RPA-64/67). 챗·분석·추천이
// 전부 이 SSE 하나로 통합됐다 (레거시 /api/agent/chat[/stream]·/analyze·/recommend는 404).
// intent 필드는 없다 — 에이전트가 message로 브랜치를 판단하므로, 버튼 동작은 프론트가
// 합성 메시지로 보낸다. operation="compact"만 결정론 신호(LLM 라우터 우회, 압축 노드 직행).
//
// 이벤트: token(챗 답변 스트리밍) / stage·partial(진행 상황) / done / error.
// done.data = { type: "answer"|"analysis"|"recommendation"|"compact", answer, sources,
//   session_id, analysis_id·analysis_result(분석 산출 시), id·version 등 저장 메타와
//   recommendation(흐름도 산출 시), compact(압축 시) } — type과 무관하게 non-null 산출물은
// 백엔드가 모두 저장하므로(예: "분석 없이 바로 흐름도" 턴은 분석+흐름도 둘 다 옴) 프론트도
// data의 필드 존재 여부로 반영해야 한다.
//
// onError(code, message): HTTP 레벨 에러는 detail.code(예: AGENT_UNAVAILABLE)를 전달하고,
// 스트림 중간의 error 이벤트는 서버가 code를 안 주므로 null로 전달한다.
export async function turnStream(
  sessionId,
  message,
  { operation = "chat", agentVersion = null, cardValues = null, onToken, onStage, onPartial, onDone, onError, signal },
) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/sessions/${sessionId}/turn`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        operation,
        // 버전은 반드시 별도 필드로만 보낸다 — 합성 메시지에 버전 문자열을 새기면
        // 백엔드 라우팅 트리거(리터럴 매칭)가 깨진다. 미선택(null)이면 필드 자체를
        // 생략해 백엔드 기본 버전으로 동작한다.
        ...(agentVersion ? { agent_version: agentVersion } : {}),
        // 질문 카드 응답 — operation="fill_cards"일 때만 실린다 (v3 결정론 반영 경로)
        ...(cardValues ? { card_values: cardValues } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return; // 세션 전환 등으로 의도적으로 취소됨 — 에러 아님
    onError("NETWORK_ERROR", t("api.errors.networkUnreachable"));
    return;
  }

  if (response.status === 401) {
    try {
      onError("UNAUTHORIZED", t("api.errors.sessionExpired"));
    } finally {
      notifyUnauthorized(); // 토큰 만료 — 로그인 화면으로 (apiRequest의 401 처리와 동일). onError가 먼저 UI에
      // 반영돼야 하므로 로그아웃(상태 초기화)은 마지막에 실행한다 — 순서를 바꾸면 로그아웃이
      // chatMessages를 먼저 갈아치워 onError가 쓴 에러 메시지가 유실된다.
    }
    return;
  }
  if (!response.ok) {
    const { code, message: errorMessage } = await readErrorDetail(response);
    onError(code, errorMessage);
    return;
  }
  if (!response.body) {
    onError("UNKNOWN", t("api.errors.noResponse"));
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

        if (event.event === "token") onToken?.(event.message ?? "");
        else if (event.event === "stage") onStage?.(event.message ?? "");
        // partial = 중간 산출물(data). 흐름도 라이브 렌더용 flow 스냅샷이 여기로 온다.
        // (기존 분석 partial은 message가 없어 stage 라인에 안 뜨던 것 — 하위호환 유지)
        else if (event.event === "partial") onPartial?.(event.data ?? null);
        else if (event.event === "done") onDone(event.data);
        else if (event.event === "error") onError(null, event.message ?? t("api.errors.unknown"));
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // 세션 전환 등으로 의도적으로 취소됨 — 에러 아님
    // 서버가 정상 error 이벤트 없이 스트림을 중간에 끊는 경우 (예: 백엔드 미처리 예외)
    onError(null, t("api.errors.streamDisconnected"));
  }
}
