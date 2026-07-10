import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { turnStream } from "../api/agent";
import { createSession } from "../api/sessions";
import { createInitialChatMessages, nowTime } from "../utils/chatMessages";
import { createTypewriter } from "../utils/typewriter";
import { usePipelineStore } from "./pipeline";

export const useChatStore = defineStore("chat", () => {
  const chatOpen = ref(false);
  const chatDocked = ref(true);
  const chatMessages = ref(createInitialChatMessages());
  const isCompacting = ref(false);
  const lastCompact = ref(null); // 최신 압축본(고정 섹션 JSON) — 압축 상태/게이지 표시용

  function toggleChat() {
    chatOpen.value = !chatOpen.value;
  }

  function closeChat() {
    chatOpen.value = false;
  }

  function dockChat() {
    chatDocked.value = true;
    chatOpen.value = false;
  }

  function undockChat() {
    chatDocked.value = false;
    chatOpen.value = false;
  }

  // /turn은 URL에 session_id가 필수다 — 문서 업로드로 이미 세션이 있으면 그 세션에,
  // 없으면 챗 전용 빈 세션을 만들어 이어서 쓴다. 같은 session_id로 계속 보내면 백엔드가
  // 대화 이력을 주입·저장해 멀티턴이 된다. (레거시 무상태 챗 엔드포인트는 제거됨)
  async function ensureChatSessionId() {
    const pipeline = usePipelineStore();
    if (pipeline.sessionId) return pipeline.sessionId;
    try {
      const { session_id } = await createSession();
      pipeline.sessionId = session_id;
    } catch {
      // 세션 생성 실패 — /turn을 부를 수 없으므로 호출부에서 에러 문구를 보여준다
    }
    return pipeline.sessionId;
  }

  // operation="chat"이면 일반 턴, "compact"면 LLM 라우터를 우회해 대화 압축 노드로 직행한다.
  // 챗 턴이라도 에이전트가 분석/흐름도를 산출할 수 있어(예: "흐름도 만들어줘") done.data의
  // 산출물을 파이프라인 스토어에 반영한다 — 분석 패널·흐름도 모달이 그대로 갱신된다.
  async function sendTurn(text, operation) {
    const pipeline = usePipelineStore();
    const trimmed = text.trim();
    if (!trimmed) return;
    chatMessages.value.push({ role: "user", text: trimmed, time: nowTime() });

    // stages는 이 턴 동안 받은 모든 진행 상태 메시지를 순서대로 쌓아 둔다 — 말풍선 위 작은
    // 텍스트(최신 상태)를 누르면 펼쳐서 전체 이력을 보여주는 용도(stagesOpen으로 펼침 여부 관리).
    // stagesDone: 턴이 끝난 뒤에도 마지막 상태가 "완료" 문구로 남도록 표시한다.
    // sources: done.data.sources(RAG 출처) — 말풍선 하단 "출처" 접기 영역으로 표시한다.
    const assistantMessage = reactive({
      role: "assistant",
      text: "",
      stages: [],
      stagesOpen: false,
      stagesDone: false,
      sources: [],
      sourcesOpen: false,
      time: nowTime(),
    });
    chatMessages.value.push(assistantMessage);

    const sessionId = await ensureChatSessionId();
    if (!sessionId) {
      assistantMessage.text = "세션을 만들지 못해 메시지를 보낼 수 없습니다. 잠시 후 다시 시도해주세요.";
      return;
    }

    const typewriter = createTypewriter(assistantMessage);

    await turnStream(sessionId, trimmed, {
      operation,
      onStage: (message) => {
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onToken: (token) => {
        typewriter.push(token);
      },
      onDone: (data) => {
        // 분석/추천/압축 턴은 token 스트림 없이 done에만 answer가 통째로 실린다 — 뭉치
        // 답변은 즉시 표시한다(P0-1: 타자기로 흘리면 긴 답변이 수 분씩 걸려 데모에 치명적).
        // 타자 효과는 token 스트림일 때만 적용된다.
        if (typewriter.started) {
          typewriter.finish();
        } else {
          assistantMessage.text = data?.answer || "답변을 생성하지 못했습니다.";
        }
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push("응답 생성 완료");
          assistantMessage.stagesDone = true;
        }
        if (Array.isArray(data?.sources) && data.sources.length) {
          assistantMessage.sources = data.sources;
        }
        // type을 명시적으로 읽어 압축 응답을 구분한다 (P2 — 산출물 반영은 필드 존재 기준 유지)
        if (data?.type === "compact" && data.compact) {
          lastCompact.value = data.compact;
        }
        pipeline.applyTurnArtifacts(data);
      },
      onError: (code, message) => {
        typewriter.finish();
        // 이미 받은 토큰이 있으면 지우지 않고 에러 문구만 이어붙인다
        assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push("오류로 중단됨");
          assistantMessage.stagesDone = true;
        }
      },
    });
  }

  async function sendChatMessage(text) {
    await sendTurn(text, "chat");
  }

  // 대화 압축 버튼 — 결정론 신호(operation="compact")로 압축 노드에 직행시킨다.
  // 압축본은 백엔드 session_compacts에 저장되고 다음 턴부터 오래된 이력을 대체한다.
  async function compactConversation() {
    if (isCompacting.value) return;
    isCompacting.value = true;
    await sendTurn("지금까지 대화 요약해줘", "compact");
    isCompacting.value = false;
  }

  // 로그아웃 시 대화창을 접고 인사말만 남은 상태로 되돌린다
  function resetForLogout() {
    chatOpen.value = false;
    chatMessages.value = createInitialChatMessages();
    isCompacting.value = false;
    lastCompact.value = null;
  }

  return {
    chatOpen,
    chatDocked,
    chatMessages,
    isCompacting,
    lastCompact,
    toggleChat,
    closeChat,
    dockChat,
    undockChat,
    sendChatMessage,
    compactConversation,
    resetForLogout,
  };
});
