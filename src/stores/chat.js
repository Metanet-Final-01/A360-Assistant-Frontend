import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { chatStream } from "../api/agent";
import { createSession } from "../api/sessions";
import { createInitialChatMessages, nowTime } from "../utils/chatMessages";
import { usePipelineStore } from "./pipeline";

export const useChatStore = defineStore("chat", () => {
  const chatOpen = ref(false);
  const chatDocked = ref(true);
  const chatMessages = ref(createInitialChatMessages());

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

  // 챗봇은 멀티턴 — session_id를 실어 보내면 백엔드가 그 세션의 대화 이력을 주입하고 이번 턴을 저장한다.
  // 문서 업로드로 이미 세션이 있으면 그 세션에, 없으면 챗 전용 빈 세션을 만들어 이어서 쓴다.
  // 이렇게 하면 이 위젯의 대화가 항상 같은 session_id로 유지되어 백엔드가 멀티턴 이력을 쌓는다.
  async function ensureChatSessionId() {
    const pipeline = usePipelineStore();
    if (pipeline.sessionId) return pipeline.sessionId;
    try {
      const { session_id } = await createSession();
      pipeline.sessionId = session_id;
    } catch {
      // 세션 생성 실패 시 무상태로 폴백 — session_id 없이 보내면 백엔드가 그냥 단발로 처리한다
    }
    return pipeline.sessionId;
  }

  async function sendChatMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    chatMessages.value.push({ role: "user", text: trimmed, time: nowTime() });

    const assistantMessage = reactive({ role: "assistant", text: "", time: nowTime() });
    chatMessages.value.push(assistantMessage);

    const sessionId = await ensureChatSessionId();

    await chatStream(
      trimmed,
      {
        onToken: (token) => {
          assistantMessage.text += token;
        },
        onDone: () => {
          if (!assistantMessage.text) assistantMessage.text = "답변을 생성하지 못했습니다.";
        },
        onError: (message) => {
          // 이미 받은 토큰이 있으면 지우지 않고 에러 문구만 이어붙인다
          assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
        },
      },
      sessionId,
    );
  }

  // 로그아웃 시 대화창을 접고 인사말만 남은 상태로 되돌린다
  function resetForLogout() {
    chatOpen.value = false;
    chatMessages.value = createInitialChatMessages();
  }

  return {
    chatOpen,
    chatDocked,
    chatMessages,
    toggleChat,
    closeChat,
    dockChat,
    undockChat,
    sendChatMessage,
    resetForLogout,
  };
});
