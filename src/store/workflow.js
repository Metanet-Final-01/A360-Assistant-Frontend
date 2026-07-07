import { reactive } from "vue";
import { uploadDocument, parseDocument } from "../api/documents";
import { chatStream } from "../api/agent";
import { analyzeSession } from "../api/analysis";
import { register as apiRegister, login as apiLogin, getMe } from "../api/auth";
import { ApiError, getToken, setToken, clearToken } from "../api/http";

// NOTE: 추천(FR-09~12)은 백엔드에 아직 엔드포인트가 없다 (API_명세.md 3번 항목 — SSE 예정).
// 분석(FR-05, /api/sessions/{id}/analyze)·챗봇(/api/agent/chat/stream)·
// 업로드/문서 상태·내용 조회(1-2~1-4)는 실제 백엔드와 연동되어 있다.
// workflow.visibleSteps(흐름도 편집 상태)는 recommend() 연동 전까지는 분석 결과(analysis.steps)를
// 그대로 옮겨와 채운다 — 추천 전용 필드(신뢰도)는 아직 없어 null로 둔다.

export function evidenceLabel(evidence) {
  if (!evidence) return "";
  const page = evidence.page != null ? `p.${evidence.page}` : "";
  const snippet = evidence.snippet ? `«${evidence.snippet}»` : "";
  return [page, snippet].filter(Boolean).join(" ");
}

function mapAnalysisStepsToFlowSteps(steps) {
  return (steps ?? []).map((step) => ({
    id: step.step_id,
    stepNo: step.order,
    title: step.name,
    action: step.description ?? "",
    package: step.systems?.length ? step.systems.join(", ") : "없음",
    inputVar: step.inputs?.length ? step.inputs.join(", ") : "없음",
    outputVar: step.outputs?.length ? step.outputs.join(", ") : "없음",
    confidence: null,
    branching: step.branching ?? "",
    evidence: evidenceLabel(step.evidence),
  }));
}

function nowTime() {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

let idSeq = 0;
function makeId(prefix) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

const GREETING = "안녕하세요! A360 액션·패키지 사용법 등 궁금한 점을 무엇이든 물어보세요.";

// 아카이브 > 챗봇 탭에 표시할 샘플 대화 기록 (실제 대화 저장 API가 아직 없어 프런트 상태로만 시작 데이터를 구성)
const ARCHIVE_SEED_SESSIONS = [
  {
    title: "A360 액션·패키지 사용법 문의",
    dateLabel: nowTime(),
    messages: [
      { role: "assistant", text: GREETING, time: "오후 12:06" },
      { role: "user", text: "자기소개해봐.", time: "오후 12:07" },
      {
        role: "assistant",
        text: "안녕하세요. 저는 Automation Anywhere Automation 360(A360) 작업을 도와드리는 추천 어시스턴트입니다.\n\n다만 현재 제공된 근거 문서가 없어, A360의 특정 패키지나 액션을 사실로 단정해서 안내할 수는 없습니다.\n\n근거 문서가 있는 경우에만 그 내용에 맞춰 정확히 추천드릴 수 있어요.\n\n원하시면 제가 다음처럼 도와드릴 수 있습니다:\n- 업무 내용을 A360 자동화 관점으로 정리\n- 어떤 종류의 패키지/액션이 필요할지 방향 제안\n- 구현 시 고려할 입력값, 예외 처리, 순서 정리\n\n근거 문서 제목: 없음(검색된 문서 없음)",
        time: "오후 12:07",
      },
    ],
  },
  {
    title: "A360 근거 문서 관련 문의",
    dateLabel: "어제",
    messages: [
      { role: "assistant", text: GREETING, time: "오전 10:12" },
      { role: "user", text: "A360이 근거 문서를 제공하지 않는 경우는 어떤 상황인가요?", time: "오전 10:13" },
      {
        role: "assistant",
        text: "업로드된 업무정의서에서 관련 내용을 찾지 못했거나, 검색된 문서의 유사도가 기준을 넘지 못한 경우입니다. 이럴 땐 추측성 답변 대신 문서 재업로드나 질문을 구체화해 주시길 안내드려요.",
        time: "오전 10:13",
      },
    ],
  },
  {
    title: "특정 패키지 액션 사실 확인",
    dateLabel: "2025.07.02",
    messages: [
      { role: "assistant", text: GREETING, time: "오후 3:41" },
      { role: "user", text: "특정 패키지의 액션이 사실인지 궁금합니다.", time: "오후 3:42" },
      {
        role: "assistant",
        text: "근거 문서에 명시된 패키지·액션만 사실로 안내해 드립니다. 확인하고 싶은 패키지명과 액션명을 알려주시면 근거 문서 기준으로 답변드릴게요.",
        time: "오후 3:42",
      },
    ],
  },
  {
    title: "추천 근거 문서 상세 요청",
    dateLabel: "2025.06.30",
    messages: [
      { role: "assistant", text: GREETING, time: "오전 9:05" },
      { role: "user", text: "추천 결과에 대한 근거 문서를 더 자세히 알고 싶어요.", time: "오전 9:06" },
      {
        role: "assistant",
        text: "각 추천 항목의 근거는 분석 결과 화면의 '근거' 항목에서 확인하실 수 있어요. 특정 단계의 근거를 더 자세히 보고 싶으시면 단계 번호를 알려주세요.",
        time: "오전 9:06",
      },
    ],
  },
  {
    title: "A360 자동화 관점 정리 요청",
    dateLabel: "2025.06.28",
    messages: [
      { role: "assistant", text: GREETING, time: "오후 1:22" },
      { role: "user", text: "A360 자동화 관점으로 업무 내용을 정리해줘.", time: "오후 1:23" },
      {
        role: "assistant",
        text: "업무 내용을 단계별로 나눠 자동화 관점(트리거, 입력값, 처리 로직, 출력값, 예외 처리)으로 정리해 드릴게요. 업무 내용을 붙여넣어 주세요.",
        time: "오후 1:23",
      },
    ],
  },
  {
    title: "패키지/액션 필요 항목 제안",
    dateLabel: "2025.06.27",
    messages: [
      { role: "assistant", text: GREETING, time: "오전 11:47" },
      { role: "user", text: "업무 수행을 위해 필요한 패키지/액션을 제안해줘.", time: "오전 11:48" },
      {
        role: "assistant",
        text: "업무 흐름을 알려주시면 단계별로 필요한 패키지와 액션 후보를 정리해 드릴게요.",
        time: "오전 11:48",
      },
    ],
  },
  {
    title: "액션 입력값 예시 문의",
    dateLabel: "2025.06.25",
    messages: [
      { role: "assistant", text: GREETING, time: "오후 4:15" },
      { role: "user", text: "특정 액션의 입력값 예시를 알고 싶습니다.", time: "오후 4:16" },
      {
        role: "assistant",
        text: "어떤 액션인지 알려주시면 근거 문서를 참고해 입력값 예시를 안내해 드릴게요.",
        time: "오후 4:16",
      },
    ],
  },
  {
    title: "패키지 순서 정리 요청",
    dateLabel: "2025.06.24",
    messages: [
      { role: "assistant", text: GREETING, time: "오전 8:50" },
      { role: "user", text: "업무 흐름에 맞는 패키지 순서를 정리해주세요.", time: "오전 8:51" },
      {
        role: "assistant",
        text: "업무 흐름의 단계를 순서대로 알려주시면, 각 단계에 맞는 패키지 실행 순서를 정리해 드릴게요.",
        time: "오전 8:51",
      },
    ],
  },
];

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)}${units[unitIndex]}`;
}

export const workflow = reactive({
  isLoggedIn: false,
  authChecking: true, // 앱 시작 시 저장된 토큰 유효성(GET /api/auth/me) 확인 중
  userEmail: null,

  // 업로드 상태
  file: null, // { name, size, ext }
  uploadStatus: "idle", // idle | uploading | parsing | uploaded | error
  uploadError: "",
  sessionId: null, // 이후 분석/추천/챗봇 API의 키
  document: null, // POST /api/documents 응답 원본 (id, status, page_count, warnings, error 등)

  // 분석 상태 (POST /api/sessions/{id}/analyze)
  analysisStatus: "idle", // idle | analyzing | done | error
  analysisStage: "", // 진행 중 stage 이벤트의 표시용 문구
  analysisError: "",
  analysis: null, // done.data 원본: { analysis_id, document_title, summary, steps, ambiguities }

  // 흐름도(FlowModal) 편집 상태 — 분석 완료 시 analysis.steps로부터 채워지며,
  // 드래그 순서 변경·수정·삭제는 이 배열에서만 이뤄진다 (analysis 원본은 그대로 둠)
  visibleSteps: [],

  // 챗봇 상태
  chatOpen: false,
  chatDocked: true,
  chatMessages: [
    {
      role: "assistant",
      text: GREETING,
      time: nowTime(),
    },
  ],

  // 아카이브 > 챗봇 상태 (대화 기록 목록 + 상세 대화)
  archiveSessions: ARCHIVE_SEED_SESSIONS.map((seed) => ({
    id: makeId("chat"),
    title: seed.title,
    dateLabel: seed.dateLabel,
    messages: seed.messages.map((message) => ({ ...message })),
  })),
  activeArchiveSessionId: null,
});
workflow.activeArchiveSessionId = workflow.archiveSessions[0]?.id ?? null;

let timers = [];
function clearTimers() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

const ALLOWED_EXT = ["pdf", "pptx"];

export async function selectFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    workflow.uploadStatus = "error";
    workflow.uploadError = "PDF 또는 PPTX 파일만 업로드할 수 있습니다.";
    return;
  }

  clearTimers();
  workflow.uploadError = "";
  workflow.file = { name: file.name, size: file.size, ext };
  workflow.uploadStatus = "uploading";
  workflow.document = null;
  workflow.analysisStatus = "idle";
  workflow.analysisStage = "";
  workflow.analysisError = "";
  workflow.analysis = null;
  workflow.visibleSteps = [];

  try {
    const document = await uploadDocument(file, workflow.sessionId);
    workflow.sessionId = document.session_id;
    workflow.document = document;

    if (document.status === "failed") {
      workflow.uploadStatus = "error";
      workflow.uploadError = document.error || "문서 파싱에 실패했습니다.";
      return;
    }
    if (document.status === "parsed") {
      // 이미 파싱된 문서(예: 텍스트로 바로 생성된 경우) — 별도 파싱 호출 불필요.
      workflow.uploadStatus = "uploaded";
      return;
    }

    // 업로드는 검증·저장만 하고 즉시 반환한다(status="uploaded") — 파싱은 별도
    // SSE 스트림(POST /documents/{id}/parse)으로 이어서 소비해야 status가
    // "parsed"로 바뀐다. 이걸 안 하면 canStartAnalysis가 영원히 false로 남는다.
    workflow.uploadStatus = "parsing";
    await parseDocument(document.id, {
      onDone: (data) => {
        workflow.document = data;
        workflow.uploadStatus = "uploaded";
      },
      onError: (_code, message) => {
        workflow.uploadStatus = "error";
        workflow.uploadError = message || "문서 파싱에 실패했습니다.";
      },
    });
  } catch (err) {
    workflow.uploadStatus = "error";
    workflow.uploadError =
      err instanceof ApiError ? err.message : "업로드 중 알 수 없는 오류가 발생했습니다.";
  }
}

export async function startAnalysis() {
  if (
    workflow.document?.status !== "parsed" ||
    !workflow.sessionId ||
    workflow.analysisStatus === "analyzing"
  ) {
    return;
  }
  workflow.analysisStatus = "analyzing";
  workflow.analysisStage = "";
  workflow.analysisError = "";
  workflow.analysis = null;

  await analyzeSession(workflow.sessionId, {
    onStage: (message) => {
      workflow.analysisStage = message;
    },
    onDone: (data) => {
      workflow.analysis = data;
      workflow.analysisStatus = "done";
      workflow.visibleSteps = mapAnalysisStepsToFlowSteps(data.steps);
    },
    onError: (code, message) => {
      // 503 AGENT_UNAVAILABLE은 엔진 랜딩 전의 레거시 케이스라 방어적으로만 남겨둔다 — 재시도 안내로 충분
      workflow.analysisStatus = "error";
      workflow.analysisError =
        code === "AGENT_UNAVAILABLE"
          ? "분석 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
          : message || "분석 중 오류가 발생했습니다.";
    },
  });
}

export function reorderWorkflowStep(fromIndex, toIndex) {
  const steps = workflow.visibleSteps;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= steps.length ||
    toIndex >= steps.length
  ) {
    return;
  }
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved);
}

export function addWorkflowStep() {
  const steps = workflow.visibleSteps;
  const nextStepNo = steps.length ? Math.max(...steps.map((s) => s.stepNo ?? 0)) + 1 : 1;
  const step = {
    id: makeId("step"),
    stepNo: nextStepNo,
    title: "",
    action: "",
    package: "없음",
    inputVar: "없음",
    outputVar: "없음",
    confidence: null,
    branching: "",
    evidence: "",
  };
  steps.push(step);
  return step;
}

export function updateWorkflowStep(id, patch) {
  const step = workflow.visibleSteps.find((s) => s.id === id);
  if (step) Object.assign(step, patch);
}

export function deleteWorkflowStep(id) {
  const idx = workflow.visibleSteps.findIndex((s) => s.id === id);
  if (idx !== -1) workflow.visibleSteps.splice(idx, 1);
}

export function resetUpload() {
  clearTimers();
  workflow.file = null;
  workflow.uploadStatus = "idle";
  workflow.uploadError = "";
  workflow.sessionId = null;
  workflow.document = null;
  workflow.analysisStatus = "idle";
  workflow.analysisStage = "";
  workflow.analysisError = "";
  workflow.analysis = null;
  workflow.visibleSteps = [];
}

export function toggleChat() {
  workflow.chatOpen = !workflow.chatOpen;
}

export function closeChat() {
  workflow.chatOpen = false;
}

export function dockChat() {
  workflow.chatDocked = true;
  workflow.chatOpen = false;
}

export function undockChat() {
  workflow.chatDocked = false;
  workflow.chatOpen = false;
}

// 챗봇은 무상태(FR-13, 멀티턴 기억 없음) — 매 질문을 /api/agent/chat/stream에 단발로 보낸다.
export async function sendChatMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  workflow.chatMessages.push({ role: "user", text: trimmed, time: nowTime() });

  const assistantMessage = reactive({ role: "assistant", text: "", time: nowTime() });
  workflow.chatMessages.push(assistantMessage);

  await chatStream(trimmed, {
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
  });
}

export function selectArchiveSession(id) {
  workflow.activeArchiveSessionId = id;
}

export function renameArchiveSession(id, title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  const session = workflow.archiveSessions.find((s) => s.id === id);
  if (session) session.title = trimmed;
}

export function deleteArchiveSession(id) {
  const idx = workflow.archiveSessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  workflow.archiveSessions.splice(idx, 1);
  if (workflow.activeArchiveSessionId === id) {
    workflow.activeArchiveSessionId = workflow.archiveSessions[0]?.id ?? null;
  }
}

// 아카이브에서 이어가는 대화도 챗봇과 동일하게 무상태 스트리밍 API를 세션별로 호출한다.
export async function sendArchiveChatMessage(sessionId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const session = workflow.archiveSessions.find((s) => s.id === sessionId);
  if (!session) return;

  session.messages.push({ role: "user", text: trimmed, time: nowTime() });
  const assistantMessage = reactive({ role: "assistant", text: "", time: nowTime() });
  session.messages.push(assistantMessage);
  session.dateLabel = nowTime();

  const idx = workflow.archiveSessions.findIndex((s) => s.id === sessionId);
  if (idx > 0) {
    const [moved] = workflow.archiveSessions.splice(idx, 1);
    workflow.archiveSessions.unshift(moved);
  }

  await chatStream(trimmed, {
    onToken: (token) => {
      assistantMessage.text += token;
    },
    onDone: () => {
      if (!assistantMessage.text) assistantMessage.text = "답변을 생성하지 못했습니다.";
    },
    onError: (message) => {
      assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
    },
  });
}

// 흐름도에서 순서 변경·수정·삭제한 내용을 반영해 내보내도록 steps는 원본이 아니라
// 편집 상태(workflow.visibleSteps)를 사용한다.
export function buildExportPayload() {
  return {
    document: workflow.file?.name ?? null,
    generatedAt: new Date().toISOString(),
    analysis: workflow.analysis
      ? {
          analysis_id: workflow.analysis.analysis_id,
          document_title: workflow.analysis.document_title,
          summary: workflow.analysis.summary,
          steps: workflow.visibleSteps,
          ambiguities: workflow.analysis.ambiguities,
        }
      : null,
  };
}

// 앱 시작 시 1회 호출. 저장된 토큰이 있으면 GET /api/auth/me로 유효성을 확인해 자동 로그인한다.
export async function bootstrapAuth() {
  const token = getToken();
  if (!token) {
    workflow.authChecking = false;
    return;
  }
  try {
    const me = await getMe();
    workflow.userEmail = me.email;
    workflow.isLoggedIn = true;
  } catch {
    clearToken();
  } finally {
    workflow.authChecking = false;
  }
}

export async function loginWithPassword(email, password) {
  const { access_token } = await apiLogin(email, password);
  setToken(access_token);
  workflow.userEmail = email;
  workflow.isLoggedIn = true;
  workflow.chatOpen = false;
  workflow.chatDocked = true;
}

// 가입 API는 access_token을 바로 내려주지만(자동 로그인용), 제품 정책상 가입 후에는
// 로그인 화면으로 보내고 사용자가 직접 로그인하도록 한다 — 그 토큰은 쓰지 않는다.
export async function registerWithPassword(email, password) {
  await apiRegister(email, password);
}

export function logout() {
  clearTimers();
  clearToken();
  workflow.isLoggedIn = false;
  workflow.userEmail = null;
  workflow.chatOpen = false;
}
