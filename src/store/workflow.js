import { reactive } from "vue";
import { uploadDocument } from "../api/documents";
import { chatStream } from "../api/agent";
import { register as apiRegister, login as apiLogin, getMe } from "../api/auth";
import { ApiError, getToken, setToken, clearToken } from "../api/http";

// NOTE: 분석(FR-05)·추천(FR-09~12)은 백엔드에 아직 엔드포인트가 없다
// (API_명세.md 3번 항목 — SSE 예정). 그 전까지는 아래 STEP_LIBRARY 목업으로 UI 흐름만 재현한다.
// 업로드/문서 상태·내용 조회(1-2~1-4)와 챗봇(/api/agent/chat/stream)은 실제 백엔드와 연동되어 있다.
const STEP_LIBRARY = [
  {
    id: "step-3",
    stepNo: 3,
    title: "'국내 금' 검색 · 시세 조회",
    action: "Browser : 요소 클릭",
    package: "없음",
    inputVar: "없음",
    outputVar: "없음",
    confidence: 0.95,
    evidence: "RAG 검색 · 패키지/변수 자동 매칭",
  },
  {
    id: "step-5",
    stepNo: 5,
    title: "최근 3일치 시세 필터",
    action: "DataTable : 행 필터",
    package: "없음",
    inputVar: "없음",
    outputVar: "없음",
    confidence: 0.89,
    evidence: "RAG 검색 · 패키지/변수 자동 매칭",
  },
  {
    id: "step-6",
    stepNo: 6,
    title: "엑셀에 시세표 작성",
    action: "Excel : 범위 쓰기 / 테두리",
    package: "없음",
    inputVar: "없음",
    outputVar: "없음",
    confidence: 0.92,
    evidence: "RAG 검색 · 패키지/변수 자동 매칭",
  },
];

function nowTime() {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  uploadStatus: "idle", // idle | uploading | uploaded | error
  uploadError: "",
  sessionId: null, // 이후 분석/추천/챗봇 API의 키
  document: null, // POST /api/documents 응답 원본 (id, status, page_count, warnings, error 등)

  // 분석/추천 상태
  analysisStatus: "idle", // idle | analyzing | done
  visibleSteps: [],

  // 챗봇 상태
  chatOpen: false,
  chatDocked: true,
  chatMessages: [
    {
      role: "assistant",
      text: "안녕하세요! A360 액션·패키지 사용법 등 궁금한 점을 무엇이든 물어보세요.",
      time: nowTime(),
    },
  ],
});

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
  workflow.visibleSteps = [];

  try {
    const document = await uploadDocument(file, workflow.sessionId);
    workflow.sessionId = document.session_id;
    workflow.document = document;

    if (document.status === "failed") {
      workflow.uploadStatus = "error";
      workflow.uploadError = document.error || "문서 파싱에 실패했습니다.";
    } else {
      workflow.uploadStatus = "uploaded";
    }
  } catch (err) {
    workflow.uploadStatus = "error";
    workflow.uploadError =
      err instanceof ApiError ? err.message : "업로드 중 알 수 없는 오류가 발생했습니다.";
  }
}

export function startAnalysis() {
  if (workflow.document?.status !== "parsed" || workflow.analysisStatus === "analyzing") return;
  workflow.analysisStatus = "analyzing";
  workflow.visibleSteps = [];

  STEP_LIBRARY.forEach((step, idx) => {
    timers.push(
      setTimeout(
        () => {
          workflow.visibleSteps.push(step);
          if (idx === STEP_LIBRARY.length - 1) {
            workflow.analysisStatus = "done";
          }
        },
        750 * (idx + 1),
      ),
    );
  });
}

export function resetUpload() {
  clearTimers();
  workflow.file = null;
  workflow.uploadStatus = "idle";
  workflow.uploadError = "";
  workflow.sessionId = null;
  workflow.document = null;
  workflow.analysisStatus = "idle";
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

export function buildExportPayload() {
  return {
    document: workflow.file?.name ?? null,
    generatedAt: new Date().toISOString(),
    steps: workflow.visibleSteps.map((step) => ({
      step: step.stepNo,
      title: step.title,
      recommendedAction: step.action,
      requiredPackage: step.package,
      inputVariable: step.inputVar,
      outputVariable: step.outputVar,
      confidence: step.confidence,
      evidence: step.evidence,
    })),
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
