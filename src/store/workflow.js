import { reactive } from "vue";
import { uploadDocument } from "../api/documents";
import { ApiError } from "../api/http";

// NOTE: 분석(FR-05)·추천(FR-09~12)·챗봇(FR-13~16)은 백엔드에 아직 엔드포인트가 없다
// (API_명세.md 3번 항목 — SSE 예정). 그 전까지는 아래 목업으로 UI 흐름만 재현한다.
// 업로드/문서 상태·내용 조회는 실제 백엔드(1-2~1-4)와 연동되어 있다.
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
  isLoggedIn: true,

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
      text: "안녕하세요! 업무정의서를 업로드하고 분석을 실행하면, 추천된 작업에 대해 무엇이든 물어보실 수 있어요.",
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

function generateReply(text) {
  if (workflow.visibleSteps.length === 0) {
    return "아직 분석된 추천 결과가 없어요. 먼저 업무정의서를 업로드하고 분석을 실행해 주세요.";
  }
  if (text.includes("패키지")) {
    return "현재 추천 항목은 A360 기본 패키지만으로 구성되어 있어 추가 패키지가 필요하지 않습니다.";
  }
  if (text.includes("변수")) {
    return "현재 단계에는 별도로 정의된 입력·출력 변수가 없습니다. 필요한 변수가 있다면 알려주세요, 반영해 드릴게요.";
  }
  if (text.includes("삭제") || text.includes("제외")) {
    return '어떤 단계를 제외할지 말씀해 주시면 추천 목록에 반영하겠습니다. (예: "5단계 제외해줘")';
  }
  if (text.includes("추가")) {
    return "추가하고 싶은 조건이나 연계 시스템을 알려주시면 해당 단계를 추천 목록에 반영하겠습니다.";
  }
  if (text.includes("근거") || text.includes("출처")) {
    return "각 추천은 업무정의서 원문과 A360 액션 카탈로그를 RAG로 검색한 결과를 근거로 매칭되었습니다.";
  }
  return `현재 문서 기준으로 ${workflow.visibleSteps.length}개 단계가 식별되었습니다. 수정하고 싶은 부분을 구체적으로 말씀해 주시면 반영해 드릴게요.`;
}

export function sendChatMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  workflow.chatMessages.push({ role: "user", text: trimmed, time: nowTime() });

  const reply = generateReply(trimmed);
  timers.push(
    setTimeout(() => {
      workflow.chatMessages.push({
        role: "assistant",
        text: reply,
        time: nowTime(),
      });
    }, 600),
  );
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

export function logout() {
  clearTimers();
  workflow.isLoggedIn = false;
  workflow.chatOpen = false;
  workflow.chatDocked = false;
}

export function login() {
  workflow.isLoggedIn = true;
}
