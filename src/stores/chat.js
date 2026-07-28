import { defineStore } from "pinia";
import { reactive, ref, watch } from "vue";
import { resumeTurnStream, turnStream } from "../api/agent";
import { createSession, listChatMessages } from "../api/sessions";
import { createInitialChatMessages, getChatGreeting, timeLabel } from "../utils/chatMessages";
import { formatTime } from "../utils/dateFormat";
import { createTypewriter } from "../utils/typewriter";
import { activeTurnKey, forgetActiveTurn, usePipelineStore, withTurnTracking } from "./pipeline";
import { useSettingsStore } from "./settings";
import { i18n, t } from "../i18n";

export const useChatStore = defineStore("chat", () => {
  const chatOpen = ref(false);
  const chatDocked = ref(true);
  const chatMessages = ref(createInitialChatMessages());
  const isCompacting = ref(false);
  const isSending = ref(false); // 이전 턴의 응답이 오기 전에는 새 턴을 보내지 않는다(응답 뒤섞임 방지)
  const lastCompact = ref(null); // 최신 압축본(고정 섹션 JSON) — 압축 상태/게이지 표시용
  // 인사말만 있고 아직 실제 대화가 시작되지 않은 상태인지 — true일 때만 언어 변경 시 인사말을
  // 새 로케일로 다시 만든다(getChatGreeting/formatTime은 호출 시점 로케일을 따르므로, 이미
  // 만들어져 배열에 굳어 있는 문자열은 로케일이 바뀌어도 저절로 갱신되지 않는다). 실제 대화가
  // 있으면 과거 메시지 언어는 건드리지 않는다.
  const isPristineGreeting = ref(true);

  watch(
    () => i18n.global.locale.value,
    () => {
      if (isPristineGreeting.value) chatMessages.value = createInitialChatMessages();
    },
  );

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
      // 세션 생성을 기다리는 동안 다른 경로(사이드바 세션 전환 등)가 이미 세션을 확정했으면
      // 그걸 우선한다 — 방금 만든 세션으로 덮어쓰면 사용자가 그 사이 전환한 세션이 사라진다.
      if (!pipeline.sessionId) pipeline.sessionId = session_id;
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
    // 사이드바에서 세션 이력을 불러오는 중(sessionLoadStatus)에도 막는다 — loadHistoryMessages가
    // 응답 도착 시 chatMessages를 통째로 교체하므로, 그 사이 보낸 메시지는 화면에서 사라진다.
    if (
      isSending.value ||
      pipeline.uploadStatus === "uploading" ||
      pipeline.analysisStatus === "analyzing" ||
      pipeline.recommendStatus === "generating" ||
      pipeline.sessionLoadStatus === "loading"
    ) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    isSending.value = true;
    try {
      isPristineGreeting.value = false;
      chatMessages.value.push({ role: "user", text: trimmed, time: formatTime() });

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
        time: formatTime(),
      });
      chatMessages.value.push(assistantMessage);

      const messagesAtStart = chatMessages.value;
      const sessionId = await ensureChatSessionId();
      if (!sessionId) {
        assistantMessage.text = t("chat.errors.sessionCreateFailed");
        return;
      }
      // 세션 생성을 기다리는 동안 다른 세션으로 전환돼 대화 목록이 통째로 바뀌었으면(위 말풍선도
      // 이미 화면에서 사라진 배열에 들어있다) 검증되지 않은 세션으로 보내지 않고 중단한다.
      if (chatMessages.value !== messagesAtStart) return;

      const typewriter = createTypewriter(assistantMessage);
      // 분석/추천 버튼 등 다른 턴이 같은 세션에서 진행 중이었다면 여기서 취소된다 — 세션당
      // 살아있는 턴은 항상 하나만 유지한다(pipeline.js 참고). cancelActiveTurn()이 fetch/reader를
      // 끊어도 이미 버퍼에 도착한 프레임은 abort 이후에도 동기적으로 마저 처리될 수 있어(스트림
      // 타이밍 문제) 세션이 그대로여도 취소된 턴의 결과가 상태를 다시 채울 수 있다 — 콜백마다
      // signal.aborted를 확인하는 게 최종 방어선이다.
      const signal = pipeline.startTurnController();
      // 부팅 시 loadAgentVersions()가 아직 끝나지 않았으면(로컬 저장 버전 복원 전) agentVersion이
      // 잠깐 null이라 첫 턴이 저장된 선택을 무시하고 백엔드 기본값으로 나갈 수 있다 — 기다린다.
      await useSettingsStore().loadAgentVersions();

      await turnStream(sessionId, trimmed, withTurnTracking(sessionId, {
        operation,
        agentVersion: useSettingsStore().agentVersion, // 설정에서 고른 버전 — null이면 필드 생략(백엔드 기본)
        signal,
        onStage: (message) => {
          if (signal.aborted) return;
          if (message?.trim()) assistantMessage.stages.push(message.trim());
        },
        onPartial: (data) => {
          if (signal.aborted) return;
          // 챗으로 흐름도를 만들거나 고칠 때도 flow 스냅샷을 "추천 흐름도 상세" 패널에 라이브로 그린다.
          pipeline.applyLiveFrame(data);
        },
        onToken: (token) => {
          if (signal.aborted) return;
          typewriter.push(token);
        },
        onDone: (data) => {
          if (signal.aborted) return;
          // 분석/추천/압축 턴은 token 스트림 없이 done에만 answer가 통째로 실린다 — 뭉치
          // 답변은 즉시 표시한다(P0-1: 타자기로 흘리면 긴 답변이 수 분씩 걸려 데모에 치명적).
          // 타자 효과는 token 스트림일 때만 적용된다.
          if (typewriter.started) {
            typewriter.finish();
          } else {
            assistantMessage.text = data?.answer || t("chat.errors.noAnswer");
          }
          if (assistantMessage.stages.length) {
            assistantMessage.stages.push(t("chat.stageDone"));
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
          pipeline.resetLiveFlow(); // 스트림 종료 → 패널이 저장된 최종본을 보여준다
        },
        onError: (code, message) => {
          if (signal.aborted) return;
          typewriter.finish();
          pipeline.resetLiveFlow(); // 실패 시 라이브 스트림 종료
          // 이미 받은 토큰이 있으면 지우지 않고 에러 문구만 이어붙인다
          assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
          if (assistantMessage.stages.length) {
            assistantMessage.stages.push(t("common.stageAborted"));
            assistantMessage.stagesDone = true;
          }
        },
      }));
    } finally {
      isSending.value = false;
    }
  }

  async function sendChatMessage(text) {
    await sendTurn(text, "chat");
  }

  // 히스토리에서 세션을 선택했을 때 그 세션의 대화 이력을 불러와 채운다(pipeline.loadSession에서 호출).
  // generation: pipeline.loadSession이 호출마다 발급하는 세대 토큰 — sessionId만으로는 같은
  // 세션을 다시 불러온 반복 호출(A→B→A)을 구분할 수 없어(sessionId가 다시 같아짐), 세대로
  // "이 시도가 여전히 최신인지"를 확인한다.
  async function loadHistoryMessages(sessionId, generation) {
    const { messages } = await listChatMessages(sessionId);
    const pipeline = usePipelineStore();
    // 응답이 오기 전에 다른 세션으로 이동했거나 같은 세션을 다시 불러왔으면 버린다
    if (pipeline.sessionId !== sessionId || pipeline.sessionGeneration !== generation) return;
    const history = (messages ?? []).map((m) => ({
      role: m.role,
      text: m.content,
      time: timeLabel(m.created_at),
    }));
    isPristineGreeting.value = !history.length;
    chatMessages.value = history.length
      ? history
      : [{ role: "assistant", text: getChatGreeting(), time: formatTime() }];
  }

  // FRONTEND_TASK_턴_재개_SSE — 새로고침(또는 다른 탭)으로 놓친 답변 스트림을 이어받는다.
  // pipeline.loadSession()이 세션 하이드레이션 마지막 단계에서 호출한다. 진행 중이던 턴의
  // 사용자 메시지는 턴이 끝나야 저장되므로 chat-messages 이력에도 없다 — 그 사용자 말풍선을
  // 되살리지는 않고(원문을 프론트가 들고 있지 않다), 이어지는 답변 말풍선만 새로 그린다.
  async function resumeActiveTurnIfNeeded(sessionId) {
    const pipeline = usePipelineStore();
    if (pipeline.sessionId !== sessionId || isSending.value) return;
    const turnId = sessionStorage.getItem(activeTurnKey(sessionId));
    if (!turnId) return;

    isSending.value = true;
    isPristineGreeting.value = false;
    const assistantMessage = reactive({
      role: "assistant",
      text: "",
      stages: [],
      stagesOpen: false,
      stagesDone: false,
      sources: [],
      sourcesOpen: false,
      time: formatTime(),
    });
    chatMessages.value.push(assistantMessage);
    const typewriter = createTypewriter(assistantMessage);
    const signal = pipeline.startTurnController();

    try {
      await resumeTurnStream(sessionId, turnId, {
        signal,
        onStage: (message) => {
          if (signal.aborted) return;
          if (message?.trim()) assistantMessage.stages.push(message.trim());
        },
        onPartial: (data) => {
          if (signal.aborted) return;
          pipeline.applyLiveFrame(data);
        },
        onToken: (token) => {
          if (signal.aborted) return;
          typewriter.push(token);
        },
        onDone: (data) => {
          forgetActiveTurn(sessionId);
          if (signal.aborted) return;
          if (typewriter.started) {
            typewriter.finish();
          } else {
            assistantMessage.text = data?.answer || t("chat.errors.noAnswer");
          }
          if (assistantMessage.stages.length) {
            assistantMessage.stages.push(t("chat.stageDone"));
            assistantMessage.stagesDone = true;
          }
          if (Array.isArray(data?.sources) && data.sources.length) {
            assistantMessage.sources = data.sources;
          }
          if (data?.type === "compact" && data.compact) {
            lastCompact.value = data.compact;
          }
          pipeline.applyTurnArtifacts(data);
          pipeline.resetLiveFlow();
        },
        onUnavailable: () => {
          forgetActiveTurn(sessionId);
          if (signal.aborted) return;
          // 재개 실패(만료·버퍼 장애 등) — 방금 그린 임시 말풍선을 포함해 서버에 저장된
          // 이력으로 통째로 다시 맞춘다. 턴이 실제로 끝나 저장까지 됐다면 그 결과가 보이고,
          // 끝내 저장되지 못했다면(만료) 조용히 사라지는 게 맞다 — 서버 상태가 진실이다.
          loadHistoryMessages(sessionId, pipeline.sessionGeneration).catch(() => {});
        },
      });
    } finally {
      isSending.value = false;
    }
  }

  // "+ 새 채팅" — 대화창을 인사말만 남은 초기 상태로 되돌린다
  function newChat() {
    chatOpen.value = false;
    chatMessages.value = createInitialChatMessages();
    isPristineGreeting.value = true;
    isCompacting.value = false;
    lastCompact.value = null;
  }

  // 대화 압축 버튼 — 결정론 신호(operation="compact")로 압축 노드에 직행시킨다.
  // 압축본은 백엔드 session_compacts에 저장되고 다음 턴부터 오래된 이력을 대체한다.
  async function compactConversation() {
    if (isCompacting.value) return;
    isCompacting.value = true;
    await sendTurn(t("chat.compactRequestMessage"), "compact");
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
    resumeActiveTurnIfNeeded,
    newChat,
    resetForLogout,
  };
});
