import { apiRequest, fetchWithAuth, notifyUnauthorized } from "./http";
import { t } from "../i18n";

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
      return {
        code: detail.code ?? "UNKNOWN",
        message: detail.message ?? response.statusText,
        turnId: detail.turn_id ?? null,
      };
    }
  } catch {
    // 본문이 JSON이 아니거나 detail이 없는 경우
  }
  return { code: "UNKNOWN", message: response.statusText, turnId: null };
}

// SSE 프레임(줄바꿈 두 번으로 구분) 파서 — POST /turn과 GET .../stream 재개 응답이 같은
// 프레임 포맷(event/message/data, 재개 응답에는 커스텀 id: 줄도 붙지만 data: 줄만 있으면
// 되므로 그대로 무시된다)을 쓰므로 리더 루프를 공유한다.
// turn_started stage는 onStage(빈 메시지 무시됨)와 별도로 onTurnStarted(turn_id, resumable)로도 전달한다.
// STREAM_INTERRUPTED — done/error 프레임 없이 연결이 끊긴 "전송 계층" 실패임을 나타내는 코드.
// 서버가 명시적으로 error 이벤트를 보냈거나 done으로 끝난 "확정된" 결과와 달리, 백엔드 턴
// 자체는 여전히 진행 중이며 재개 가능할 수 있다 — withTurnTracking이 이 코드일 때는 재개
// 커서(activeTurnKey)를 지우지 않는 이유(Qodo 리뷰)가 여기서 갈린다.
export const STREAM_INTERRUPTED = "STREAM_INTERRUPTED";

async function pumpEventStream(response, { onToken, onStage, onPartial, onDone, onError, onTurnStarted }) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // done/error 이벤트를 실제로 받았는지 추적한다 — 못 받고 EOF로 끝나면(프록시 타임아웃,
  // 백엔드 크래시 등) "성공적으로 끝남"이 아니라 중단으로 취급해야 한다(Qodo 리뷰). 그렇지
  // 않으면 onDone/onError 어느 쪽도 안 불려 호출부의 임시 말풍선이 영원히 미완성 상태로 남고,
  // activeTurnKey도 지워지지 않아 다음 새로고침이 이미 끝난(또는 죽은) 턴을 계속 재개 시도한다.
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

        if (event.event === "token") onToken?.(event.message ?? "");
        else if (event.event === "stage") {
          onStage?.(event.message ?? "");
          if (event.stage === "turn_started") {
            onTurnStarted?.(event.data?.turn_id ?? null, !!event.data?.resumable);
          }
        } else if (event.event === "partial") onPartial?.(event.data ?? null);
        else if (event.event === "done") {
          sawTerminal = true;
          onDone(event.data);
        } else if (event.event === "error") {
          sawTerminal = true;
          onError(null, event.message ?? t("api.errors.unknown"));
        }
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // 세션 전환 등으로 의도적으로 취소됨 — 에러 아님
    // 서버가 정상 error 이벤트 없이 스트림을 중간에 끊는 경우 (예: 백엔드 미처리 예외) — 전송
    // 계층 실패이므로 확정된 서버 에러(위 event.event === "error")와 구분해 STREAM_INTERRUPTED로 알린다.
    onError(STREAM_INTERRUPTED, t("api.errors.streamDisconnected"));
    return;
  }

  if (!sawTerminal) onError(STREAM_INTERRUPTED, t("api.errors.streamDisconnected"));
}

// GET /api/sessions/{sessionId}/turns/{turnId}/stream — 새로고침 등으로 놓친 SSE를 이어받는다
// (FRONTEND_TASK_턴_재개_SSE). after는 일부러 보내지 않는다 — 생략하면 서버가 처음부터 전부
// 재생하는데, 토큰이 되풀이돼도 결과(누적 텍스트)는 동일하고 커서 관리가 필요 없어 더 단순하다.
// 이 엔드포인트 레벨의 모든 실패(503 RESUME_UNAVAILABLE·404 TURN_NOT_FOUND·네트워크 오류)와
// 스트림 도중의 error 프레임은 onUnavailable() 하나로 모아 알린다 — 호출부는 GET
// /chat-messages로 복원하는 것 외엔 딱히 세분화해서 할 일이 없다(명세의 "잦은 케이스" 절 참고).
export async function resumeTurnStream(
  sessionId,
  turnId,
  { onToken, onStage, onPartial, onDone, onTurnStarted, onUnavailable, signal },
) {
  let response;
  try {
    response = await fetchWithAuth(`/api/sessions/${sessionId}/turns/${turnId}/stream`, { signal });
  } catch (err) {
    if (err?.name === "AbortError") return;
    onUnavailable?.();
    return;
  }
  if (response.status === 401) {
    try {
      onUnavailable?.();
    } finally {
      notifyUnauthorized(); // 토큰 만료 — 재개 요청도 turnStream()과 동일하게 강제 로그아웃해야
      // 앱이 만료된 로그인 상태로 남지 않는다(Qodo 리뷰). onUnavailable이 먼저 폴백을 그려야
      // 하므로 로그아웃(상태 초기화)은 마지막에 실행한다.
    }
    return;
  }
  if (!response.ok || !response.body) {
    onUnavailable?.();
    return;
  }

  await pumpEventStream(response, {
    onToken,
    onStage,
    onPartial,
    onDone,
    onTurnStarted,
    onError: () => onUnavailable?.(), // 도중 error 프레임·연결 끊김 → chat-messages 복원으로 폴백
  });
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
  {
    operation = "chat",
    agentVersion = null,
    cardValues = null,
    onToken,
    onStage,
    onPartial,
    onDone,
    onError,
    onTurnStarted,
    signal,
  },
) {
  let response;
  try {
    response = await fetchWithAuth(`/api/sessions/${sessionId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const { code, message: errorMessage, turnId } = await readErrorDetail(response);
    // 409 TURN_IN_PROGRESS — 이미 다른 턴(다른 탭·기기, 또는 새로고침 전 이 브라우저)이 같은
    // 세션에서 진행 중이라 이번에 보낸 메시지는 저장되지 않고 거부됐다. 예전엔 여기서 곧장 그
    // turn_id로 재구독했는데, 그러면 방금 보낸(실제로는 거부된) 새 메시지용 콜백으로 완전히
    // 다른 턴의 답변이 흘러들어가 엉뚱한 말풍선이 채워졌다(Qodo 리뷰). 이 함수는 재구독 여부를
    // 스스로 결정하지 않고, 충돌한 turn_id를 그대로 onError에 실어 호출부가 판단하게 한다 —
    // 호출부는 이미 그려 둔 낙관적 UI(사용자 메시지·빈 답변 말풍선)를 먼저 정리한 뒤에야
    // 그 turn_id를 재구독해야 안전하다.
    if (response.status === 409 && turnId) {
      onError("TURN_IN_PROGRESS", errorMessage, turnId);
      return;
    }
    onError(code, errorMessage);
    return;
  }
  if (!response.body) {
    onError("UNKNOWN", t("api.errors.noResponse"));
    return;
  }

  await pumpEventStream(response, { onToken, onStage, onPartial, onDone, onError, onTurnStarted });
}
