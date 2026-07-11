import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { turnStream } from "../api/agent";
import { createSession, listChatMessages } from "../api/sessions";
import { CHAT_GREETING, createInitialChatMessages, nowTime, timeLabel } from "../utils/chatMessages";
import { createTypewriter } from "../utils/typewriter";
import { usePipelineStore } from "./pipeline";

export const useChatStore = defineStore("chat", () => {
  const chatOpen = ref(false);
  const chatDocked = ref(true);
  const chatMessages = ref(createInitialChatMessages());
  const isCompacting = ref(false);
  const isSending = ref(false); // 이전 턴의 응답이 오기 전에는 새 턴을 보내지 않는다(응답 뒤섞임 방지)
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
    // 이전 턴이 아직 진행 중이면(챗 자체든, 업로드·분석·추천처럼 같은 턴 컨트롤러를 쓰는
    // 파이프라인 작업이든) 새 턴을 받지 않는다 — 동시에 나가면 응답 순서가 보장되지 않거나
    // (챗 대 챗) 먼저 시작된 작업이 중간에 끊긴다(챗 대 업로드/분석/추천, pipeline.js의
    // startTurnController가 이전 컨트롤러를 abort함). ChatWidget 입력창도 같은 조건으로
    // 비활성화되지만(App.vue의 chatBlocked), 이건 그 UI 가드가 우회되더라도 지켜지는
    // 최종 방어선이다.
    if (
      isSending.value ||
      pipeline.uploadStatus === "uploading" ||
      pipeline.analysisStatus === "analyzing" ||
      pipeline.recommendStatus === "generating"
    ) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    isSending.value = true;
    try {
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
        // 분석/추천 버튼 등 다른 턴이 같은 세션에서 진행 중이었다면 여기서 취소된다 — 세션당
        // 살아있는 턴은 항상 하나만 유지한다(pipeline.js 참고).
        signal: pipeline.startTurnController(),
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
    } finally {
      isSending.value = false;
    }
  }

  async function sendChatMessage(text) {
    await sendTurn(text, "chat");
  }

  // 히스토리에서 세션을 선택했을 때 그 세션의 대화 이력을 불러와 채운다(pipeline.loadSession에서 호출).
  async function loadHistoryMessages(sessionId) {
    const { messages } = await listChatMessages(sessionId);
    // 응답이 오기 전에 다른 세션으로 이동했으면 버린다 (pipeline.loadSession의 세션 전환 가드와 동일)
    if (usePipelineStore().sessionId !== sessionId) return;
    const history = (messages ?? []).map((m) => ({
      role: m.role,
      text: m.content,
      time: timeLabel(m.created_at),
    }));
    chatMessages.value = history.length
      ? history
      : [{ role: "assistant", text: CHAT_GREETING, time: nowTime() }];
  }

  // "+ 새 채팅" — 대화창을 인사말만 남은 초기 상태로 되돌린다
  function newChat() {
    chatOpen.value = false;
    chatMessages.value = createInitialChatMessages();
    isCompacting.value = false;
    lastCompact.value = null;
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
    newChat();
  }

  return {
    chatOpen,
    chatDocked,
    chatMessages,
    isCompacting,
    isSending,
    lastCompact,
    toggleChat,
    closeChat,
    dockChat,
    undockChat,
    sendChatMessage,
    compactConversation,
    loadHistoryMessages,
    newChat,
    resetForLogout,
  };
});
