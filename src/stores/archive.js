import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { turnStream } from "../api/agent";
import { listSessions, deleteSession, listChatMessages, getLatestAnalysis } from "../api/sessions";
import { getLatestRecommendation } from "../api/recommend";
import { ApiError } from "../api/http";
import { CHAT_GREETING, nowTime } from "../utils/chatMessages";

// 아카이브 = 실제 세션 이력 (P0-2, 목업 시드 제거).
// 목록은 GET /api/sessions(Bearer 필수), 상세는 선택 시 그 세션의
// chat-messages / analyses/latest / recommendations/latest 세 개를 불러 화면을 구성한다.
// 분석·추천이 없는 세션(챗만 한 세션)도 목록에 나오므로 상세는 "없음"을 정상 상태로 다룬다.

function dateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function timeLabel(iso) {
  if (!iso) return nowTime();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nowTime();
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export const useArchiveStore = defineStore("archive", () => {
  // 세션 목록
  const sessions = ref([]); // [{ id, title, solution, created_at, updated_at, dateLabel }]
  const listStatus = ref("idle"); // idle | loading | done | error
  const listError = ref("");
  const activeSessionId = ref(null);

  // 선택 세션 상세 (세 API 병렬 로드)
  const detailStatus = ref("idle"); // idle | loading | done | error
  const detailError = ref("");
  const detailAnalysis = ref(null); // AnalysisResult(result 필드) | null — 분석 없는 세션은 null
  const detailRecommendation = ref(null); // { version, recommendation } | null
  const detailMessages = ref([]); // ChatWidget 형식 [{ role, text, time, sources?, ... }]

  const archiveChatOpen = ref(false);
  const archiveChatDocked = ref(true);

  function toggleArchiveChat() {
    archiveChatOpen.value = !archiveChatOpen.value;
  }

  function closeArchiveChat() {
    archiveChatOpen.value = false;
  }

  function dockArchiveChat() {
    archiveChatDocked.value = true;
    archiveChatOpen.value = false;
  }

  function undockArchiveChat() {
    archiveChatDocked.value = false;
    archiveChatOpen.value = false;
  }

  async function loadSessions() {
    listStatus.value = "loading";
    listError.value = "";
    try {
      const { sessions: rows } = await listSessions();
      sessions.value = rows.map((s) => ({ ...s, dateLabel: dateLabel(s.updated_at ?? s.created_at) }));
      listStatus.value = "done";
      // 선택이 없거나 삭제된 세션을 가리키면 첫 세션을 자동 선택
      if (!sessions.value.some((s) => s.id === activeSessionId.value)) {
        activeSessionId.value = sessions.value[0]?.id ?? null;
        if (activeSessionId.value) loadSessionDetail(activeSessionId.value);
        else resetDetail();
      }
    } catch (err) {
      listStatus.value = "error";
      listError.value = err instanceof ApiError ? err.message : "세션 목록을 불러오지 못했습니다.";
      sessions.value = [];
      resetDetail();
    }
  }

  function resetDetail() {
    detailStatus.value = "idle";
    detailError.value = "";
    detailAnalysis.value = null;
    detailRecommendation.value = null;
    detailMessages.value = [];
  }

  // 404(NO_ANALYSIS/NO_RECOMMENDATION)는 "아직 없음"이라는 정상 상태 — null로 삼킨다.
  async function swallowNotFound(promise) {
    try {
      return await promise;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  async function loadSessionDetail(sessionId) {
    detailStatus.value = "loading";
    detailError.value = "";
    try {
      const [messages, analysis, recommendation] = await Promise.all([
        listChatMessages(sessionId),
        swallowNotFound(getLatestAnalysis(sessionId)),
        swallowNotFound(getLatestRecommendation(sessionId)),
      ]);
      // 응답이 오기 전에 다른 세션으로 이동했으면 버린다
      if (activeSessionId.value !== sessionId) return;

      detailAnalysis.value = analysis?.result ?? null;
      detailRecommendation.value = recommendation ?? null;
      const history = (messages?.messages ?? []).map((m) => ({
        role: m.role,
        text: m.content,
        time: timeLabel(m.created_at),
      }));
      detailMessages.value = history.length
        ? history
        : [{ role: "assistant", text: CHAT_GREETING, time: nowTime() }];
      detailStatus.value = "done";
    } catch (err) {
      if (activeSessionId.value !== sessionId) return;
      detailStatus.value = "error";
      detailError.value = err instanceof ApiError ? err.message : "세션 상세를 불러오지 못했습니다.";
    }
  }

  function selectSession(id) {
    if (activeSessionId.value === id) return;
    activeSessionId.value = id;
    resetDetail();
    loadSessionDetail(id);
  }

  async function removeSession(id) {
    try {
      await deleteSession(id);
    } catch (err) {
      listError.value = err instanceof ApiError ? err.message : "세션을 삭제하지 못했습니다.";
      return;
    }
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
      resetDetail();
      if (activeSessionId.value) loadSessionDetail(activeSessionId.value);
    }
  }

  // 선택된 세션에서 대화를 이어간다 — 세션이 이미 백엔드에 존재하므로 그 id로 바로 /turn.
  // 이 턴이 분석/흐름도를 새로 만들면 상세 화면(detailAnalysis/detailRecommendation)에도 반영한다.
  async function sendArchiveChatMessage(text) {
    const trimmed = text.trim();
    const sessionId = activeSessionId.value;
    if (!trimmed || !sessionId) return;

    detailMessages.value.push({ role: "user", text: trimmed, time: nowTime() });
    const assistantMessage = reactive({ role: "assistant", text: "", sources: [], sourcesOpen: false, time: nowTime() });
    detailMessages.value.push(assistantMessage);

    await turnStream(sessionId, trimmed, {
      onToken: (token) => {
        assistantMessage.text += token;
      },
      onDone: (data) => {
        if (!assistantMessage.text) assistantMessage.text = data?.answer || "답변을 생성하지 못했습니다.";
        if (Array.isArray(data?.sources) && data.sources.length) assistantMessage.sources = data.sources;
        if (activeSessionId.value === sessionId) {
          if (data?.analysis_result) detailAnalysis.value = data.analysis_result;
          if (data?.recommendation) {
            detailRecommendation.value = { version: data.version, recommendation: data.recommendation };
          }
        }
      },
      onError: (code, message) => {
        assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
      },
    });
  }

  function resetForLogout() {
    sessions.value = [];
    listStatus.value = "idle";
    listError.value = "";
    activeSessionId.value = null;
    resetDetail();
    archiveChatOpen.value = false;
    archiveChatDocked.value = true;
  }

  return {
    sessions,
    listStatus,
    listError,
    activeSessionId,
    detailStatus,
    detailError,
    detailAnalysis,
    detailRecommendation,
    detailMessages,
    archiveChatOpen,
    archiveChatDocked,
    toggleArchiveChat,
    closeArchiveChat,
    dockArchiveChat,
    undockArchiveChat,
    loadSessions,
    selectSession,
    removeSession,
    sendArchiveChatMessage,
    resetForLogout,
  };
});
