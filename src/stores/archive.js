import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { chatStream } from "../api/agent";
import { createSession } from "../api/sessions";
import { createInitialChatMessages, nowTime } from "../utils/chatMessages";
import { evidenceLabel } from "../utils/format";
import { makeId } from "../utils/id";

// 아카이브 화면에 표시할 샘플 분석 결과 목록 (결과 조회/보관 API가 아직 없어
// 프런트 상태로만 시작 데이터를 구성 — 실제 연동 전까지 목업으로 화면을 채운다)
function makeResultStep({ stepNo, title, action, pkg, inputVar, outputVar, page, snippet, branching = "" }) {
  return {
    id: makeId("result-step"),
    stepNo,
    title,
    action,
    package: pkg,
    inputVar,
    outputVar,
    confidence: null,
    branching,
    evidence: evidenceLabel({ page, snippet }),
  };
}

const ARCHIVE_RESULT_SEEDS = [
  {
    title: "RPA 업무정의서 분석 결과",
    fileName: "과제1_첨부자료.pdf",
    fileExt: "pdf",
    dateLabel: "2025.07.08 10:30",
    documentTitle: "RPA 업무정의서",
    summary:
      "네이버에 접속해 증권 메뉴에서 국내 금 시세를 조회한 뒤, 조회된 일별 시세를 엑셀 표로 가공하고 해당 엑셀 표를 메일로 발송하는 업무입니다. 문서에는 4개의 작업(Task)으로 순서가 나뉘어 있으며, 각 단계는 웹 조회, 엑셀 가공, 메일 발송으로 구성됩니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "네이버 접속",
        action: "네이버 웹사이트에 접속한다.",
        pkg: "Edge",
        inputVar: "네이버",
        outputVar: "네이버 접속 화면",
        page: 3,
        snippet: "작업 순서 1. 네이버 접속 2. 증권 버튼 클릭 사용 프로그램",
      }),
      makeResultStep({
        stepNo: 2,
        title: "증권 메뉴 클릭",
        action: "네이버에서 증권 버튼을 클릭해 증권 페이지로 이동한다.",
        pkg: "Edge",
        inputVar: "네이버 접속 화면",
        outputVar: "증권 페이지",
        page: 3,
        snippet: "작업 순서 1. 네이버 접속 2. 증권 버튼 클릭 사용 프로그램",
      }),
      makeResultStep({
        stepNo: 3,
        title: "국내 금 클릭",
        action: "증권 페이지에서 '국내 금'을 클릭해 금 시세 조회 화면으로 이동한다.",
        pkg: "Edge",
        inputVar: "증권 페이지",
        outputVar: "국내 금 시세 조회 화면",
        page: 4,
        snippet: "작업 순서 3. 국내 금 클릭 4. 일별 시세 엑셀 가공 사용 프로그램",
      }),
      makeResultStep({
        stepNo: 4,
        title: "일별 시세 엑셀 가공",
        action: "일별 시세 표를 엑셀에 넣고, 최근 3일치 일별 시세를 가져와 엑셀 표 테두리를 설정한다.",
        pkg: "Excel",
        inputVar: "일별 시세 표",
        outputVar: "금 시세 내역 엑셀, 최근 3일치 일별 시세가 반영된 엑셀 표",
        page: 5,
        snippet: "작업 순서 1. 일별 시세 표 엑셀에 넣기 2. 최근 3일치 일별 시세 가져오기 3. 엑셀 표 테두리 설정 사용 프로그램",
      }),
    ],
  },
  {
    title: "ERP 시스템 개선 분석 결과",
    fileName: "ERP_업무정의서_v2.xlsx",
    fileExt: "xlsx",
    dateLabel: "2025.07.07 15:20",
    documentTitle: "ERP 시스템 개선 업무정의서",
    summary:
      "사내 ERP 시스템의 재고관리 모듈 화면을 개선하기 위한 요구사항을 정리한 문서입니다. 화면 진입부터 재고 조회, 발주 결재 상신까지 3단계로 구성됩니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "ERP 로그인",
        action: "ERP 포털에 접속해 사번과 비밀번호로 로그인한다.",
        pkg: "ERP Portal",
        inputVar: "사번, 비밀번호",
        outputVar: "ERP 메인 화면",
        page: 2,
        snippet: "1. ERP 포털 접속 2. 사번/비밀번호 입력",
      }),
      makeResultStep({
        stepNo: 2,
        title: "재고 현황 조회",
        action: "재고관리 메뉴에서 창고별 재고 현황을 조회한다.",
        pkg: "ERP Portal",
        inputVar: "ERP 메인 화면",
        outputVar: "재고 현황 표",
        page: 4,
        snippet: "재고관리 > 창고별 현황 조회",
      }),
      makeResultStep({
        stepNo: 3,
        title: "발주 결재 상신",
        action: "조회된 재고 현황을 바탕으로 발주 요청서를 작성해 결재 상신한다.",
        pkg: "ERP Portal, Outlook",
        inputVar: "재고 현황 표",
        outputVar: "발주 요청서",
        page: 6,
        snippet: "발주 요청서 작성 후 결재라인 상신",
      }),
    ],
  },
  {
    title: "고객 지원 프로세스 분석 결과",
    fileName: "고객지원_업무정의서.pdf",
    fileExt: "pdf",
    dateLabel: "2025.07.06 14:10",
    documentTitle: "고객 지원 프로세스 업무정의서",
    summary: "고객센터에 접수된 문의를 티켓 시스템에 등록하고 담당자에게 배정한 뒤 처리 결과를 이메일로 회신하는 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "문의 접수 확인",
        action: "고객센터 게시판에서 신규 문의를 확인한다.",
        pkg: "고객센터 포털",
        inputVar: "없음",
        outputVar: "문의 목록",
        page: 1,
        snippet: "신규 문의 게시판 확인",
      }),
      makeResultStep({
        stepNo: 2,
        title: "티켓 등록",
        action: "확인된 문의를 티켓 시스템에 등록한다.",
        pkg: "Zendesk",
        inputVar: "문의 목록",
        outputVar: "티켓 번호",
        page: 2,
        snippet: "문의 내용 기반 티켓 생성",
      }),
      makeResultStep({
        stepNo: 3,
        title: "담당자 배정 및 회신",
        action: "담당 부서에 티켓을 배정하고 처리 결과를 이메일로 회신한다.",
        pkg: "Zendesk, Outlook",
        inputVar: "티켓 번호",
        outputVar: "회신 메일",
        page: 3,
        snippet: "담당 부서 배정 후 처리 결과 회신",
      }),
    ],
  },
  {
    title: "구매 관리 프로세스 분석 결과",
    fileName: "구매관리_정의서.docx",
    fileExt: "docx",
    dateLabel: "2025.07.05 11:45",
    documentTitle: "구매 관리 프로세스 업무정의서",
    summary: "구매 요청서를 접수해 협력사 견적을 비교하고 발주를 확정하는 구매 관리 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "구매 요청서 접수",
        action: "부서별 구매 요청서를 그룹웨어에서 확인한다.",
        pkg: "그룹웨어",
        inputVar: "없음",
        outputVar: "요청 목록",
        page: 1,
        snippet: "부서별 구매 요청 게시판 확인",
      }),
      makeResultStep({
        stepNo: 2,
        title: "견적 비교",
        action: "협력사별 견적서를 비교해 최적 공급처를 선정한다.",
        pkg: "Excel",
        inputVar: "요청 목록",
        outputVar: "견적 비교표",
        page: 3,
        snippet: "협력사 견적서 취합 및 비교",
      }),
      makeResultStep({
        stepNo: 3,
        title: "발주 확정",
        action: "선정된 공급처에 발주서를 발송한다.",
        pkg: "Outlook",
        inputVar: "견적 비교표",
        outputVar: "발주서",
        page: 5,
        snippet: "공급처 확정 후 발주서 발송",
      }),
    ],
  },
  {
    title: "영업 프로세스 분석 결과",
    fileName: "영업_프로세스.xlsx",
    fileExt: "xlsx",
    dateLabel: "2025.07.04 09:30",
    documentTitle: "영업 프로세스 업무정의서",
    summary: "잠재 고객 리스트를 CRM에서 조회해 견적서를 발송하고 계약 진행 상태를 갱신하는 영업 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "리드 조회",
        action: "CRM에서 이번 주 신규 리드를 조회한다.",
        pkg: "Salesforce",
        inputVar: "없음",
        outputVar: "리드 목록",
        page: 2,
        snippet: "이번 주 신규 리드 필터 조회",
      }),
      makeResultStep({
        stepNo: 2,
        title: "견적서 발송",
        action: "리드별 맞춤 견적서를 작성해 이메일로 발송한다.",
        pkg: "Excel, Outlook",
        inputVar: "리드 목록",
        outputVar: "견적서",
        page: 4,
        snippet: "리드 맞춤 견적서 작성 및 발송",
      }),
      makeResultStep({
        stepNo: 3,
        title: "계약 상태 갱신",
        action: "발송 결과를 CRM의 계약 상태 값에 반영한다.",
        pkg: "Salesforce",
        inputVar: "견적서",
        outputVar: "계약 상태",
        page: 6,
        snippet: "계약 진행 상태 필드 갱신",
      }),
    ],
  },
  {
    title: "재무 보고 프로세스 분석 결과",
    fileName: "재무보고_정의서.pdf",
    fileExt: "pdf",
    dateLabel: "2025.07.03 16:20",
    documentTitle: "재무 보고 프로세스 업무정의서",
    summary: "월별 재무 데이터를 회계 시스템에서 추출해 보고서 양식에 반영하고 결재 상신하는 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "재무 데이터 추출",
        action: "회계 시스템에서 월별 매출/비용 데이터를 추출한다.",
        pkg: "SAP",
        inputVar: "없음",
        outputVar: "재무 데이터",
        page: 1,
        snippet: "월별 매출/비용 데이터 추출",
      }),
      makeResultStep({
        stepNo: 2,
        title: "보고서 작성",
        action: "추출한 데이터를 재무 보고서 양식에 반영한다.",
        pkg: "Excel",
        inputVar: "재무 데이터",
        outputVar: "재무 보고서",
        page: 3,
        snippet: "재무 보고서 양식에 데이터 반영",
      }),
      makeResultStep({
        stepNo: 3,
        title: "결재 상신",
        action: "작성된 보고서를 결재라인에 상신한다.",
        pkg: "그룹웨어",
        inputVar: "재무 보고서",
        outputVar: "결재 문서",
        page: 5,
        snippet: "결재라인 상신",
      }),
    ],
  },
  {
    title: "인사 채용 프로세스 분석 결과",
    fileName: "채용_프로세스.pdf",
    fileExt: "pdf",
    dateLabel: "2025.07.02 13:15",
    documentTitle: "인사 채용 프로세스 업무정의서",
    summary: "채용 공고 등록부터 지원자 서류 심사, 면접 일정 안내까지 처리하는 채용 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "채용 공고 등록",
        action: "채용 사이트에 신규 공고를 등록한다.",
        pkg: "사람인",
        inputVar: "없음",
        outputVar: "공고 페이지",
        page: 1,
        snippet: "신규 공고 등록",
      }),
      makeResultStep({
        stepNo: 2,
        title: "서류 심사 및 안내",
        action: "접수된 지원서를 심사하고 합격자에게 면접 일정을 이메일로 안내한다.",
        pkg: "Excel, Outlook",
        inputVar: "지원서 목록",
        outputVar: "면접 안내 메일",
        page: 4,
        snippet: "서류 합격자 면접 일정 안내",
      }),
    ],
  },
  {
    title: "물류 배송 프로세스 분석 결과",
    fileName: "물류배송_정의서.xlsx",
    fileExt: "xlsx",
    dateLabel: "2025.07.01 10:05",
    documentTitle: "물류 배송 프로세스 업무정의서",
    summary: "출고 요청을 접수해 배송사에 전달하고 배송 상태를 추적하는 물류 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "출고 요청 확인",
        action: "WMS에서 신규 출고 요청 목록을 확인한다.",
        pkg: "WMS",
        inputVar: "없음",
        outputVar: "출고 목록",
        page: 2,
        snippet: "신규 출고 요청 확인",
      }),
      makeResultStep({
        stepNo: 2,
        title: "배송 상태 추적",
        action: "배송사 시스템에서 송장별 배송 상태를 조회해 갱신한다.",
        pkg: "배송사 포털",
        inputVar: "출고 목록",
        outputVar: "배송 현황",
        page: 5,
        snippet: "송장별 배송 상태 조회 및 갱신",
      }),
    ],
  },
  {
    title: "계약 관리 프로세스 분석 결과",
    fileName: "계약관리_정의서.docx",
    fileExt: "docx",
    dateLabel: "2025.06.30 16:40",
    documentTitle: "계약 관리 프로세스 업무정의서",
    summary: "계약서 초안을 검토하고 전자서명을 요청한 뒤 계약 대장에 등록하는 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "계약서 검토",
        action: "법무팀 검토 의견을 반영해 계약서 초안을 수정한다.",
        pkg: "Word",
        inputVar: "계약서 초안",
        outputVar: "수정본",
        page: 2,
        snippet: "법무팀 검토 의견 반영",
      }),
      makeResultStep({
        stepNo: 2,
        title: "전자서명 및 등록",
        action: "전자서명을 요청하고 완료된 계약서를 계약 대장에 등록한다.",
        pkg: "모두싸인",
        inputVar: "수정본",
        outputVar: "계약 대장 항목",
        page: 4,
        snippet: "전자서명 완료 후 계약 대장 등록",
      }),
    ],
  },
  {
    title: "마케팅 캠페인 분석 결과",
    fileName: "마케팅캠페인_정의서.pdf",
    fileExt: "pdf",
    dateLabel: "2025.06.29 09:50",
    documentTitle: "마케팅 캠페인 업무정의서",
    summary: "캠페인 소재를 제작해 채널별로 발행하고 성과 데이터를 취합하는 마케팅 업무입니다.",
    steps: [
      makeResultStep({
        stepNo: 1,
        title: "소재 제작",
        action: "캠페인 기획안에 맞춰 이미지·문구 소재를 제작한다.",
        pkg: "Figma",
        inputVar: "기획안",
        outputVar: "캠페인 소재",
        page: 1,
        snippet: "기획안 기반 소재 제작",
      }),
      makeResultStep({
        stepNo: 2,
        title: "채널 발행 및 성과 취합",
        action: "제작된 소재를 SNS 채널에 발행하고 조회수·클릭수를 취합한다.",
        pkg: "Meta Business Suite",
        inputVar: "캠페인 소재",
        outputVar: "성과 리포트",
        page: 3,
        snippet: "채널 발행 및 성과 데이터 취합",
      }),
    ],
  },
];

function createArchiveResults() {
  return ARCHIVE_RESULT_SEEDS.map((seed) => ({
    id: makeId("result"),
    title: seed.title,
    fileName: seed.fileName,
    fileExt: seed.fileExt,
    dateLabel: seed.dateLabel,
    analysis: {
      document_title: seed.documentTitle,
      summary: seed.summary,
      steps: seed.steps.map((step) => ({ ...step })),
      ambiguities: [],
    },
    // 분석 결과 하나당 챗봇 대화 하나가 대응된다 — 대화를 이어가면 그 결과 전용 백엔드
    // 세션을 만들어 여기 저장한다 (같은 결과는 항상 같은 session_id로 보내 멀티턴을 쌓는다).
    backendSessionId: null,
    messages: createInitialChatMessages(),
  }));
}

export const useArchiveStore = defineStore("archive", () => {
  const archiveResults = ref(createArchiveResults());
  const activeArchiveResultId = ref(archiveResults.value[0]?.id ?? null);
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

  function selectArchiveResult(id) {
    activeArchiveResultId.value = id;
  }

  function renameArchiveResult(id, title) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const result = archiveResults.value.find((r) => r.id === id);
    if (result) result.title = trimmed;
  }

  function deleteArchiveResult(id) {
    const idx = archiveResults.value.findIndex((r) => r.id === id);
    if (idx === -1) return;
    archiveResults.value.splice(idx, 1);
    if (activeArchiveResultId.value === id) {
      activeArchiveResultId.value = archiveResults.value[0]?.id ?? null;
    }
  }

  // 분석 결과 하나당 챗봇 대화가 대응되므로, 현재 선택된 결과를 대상으로 대화를 이어간다.
  // 대화별 백엔드 세션을 만들어(최초 1회) 그 session_id로 계속 보낸다 — 메인 챗 위젯의
  // pipeline.sessionId(문서 파이프라인 세션)와는 별개 세션이라 서로 이력이 섞이지 않는다.
  async function sendArchiveChatMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = archiveResults.value.find((r) => r.id === activeArchiveResultId.value);
    if (!result) return;

    if (!result.backendSessionId) {
      try {
        const { session_id } = await createSession();
        result.backendSessionId = session_id;
      } catch {
        // 세션 생성 실패 시 무상태로 폴백 — session_id 없이 보내면 백엔드가 단발로 처리한다
      }
    }

    result.messages.push({ role: "user", text: trimmed, time: nowTime() });
    const assistantMessage = reactive({ role: "assistant", text: "", time: nowTime() });
    result.messages.push(assistantMessage);

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
          assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n⚠ ${message}` : message;
        },
      },
      result.backendSessionId,
    );
  }

  // 로그아웃 시 목업 데이터를 초기 상태로 되돌린다
  function resetForLogout() {
    archiveResults.value = createArchiveResults();
    activeArchiveResultId.value = archiveResults.value[0]?.id ?? null;
    archiveChatOpen.value = false;
    archiveChatDocked.value = true;
  }

  return {
    archiveResults,
    activeArchiveResultId,
    archiveChatOpen,
    archiveChatDocked,
    toggleArchiveChat,
    closeArchiveChat,
    dockArchiveChat,
    undockArchiveChat,
    selectArchiveResult,
    renameArchiveResult,
    deleteArchiveResult,
    sendArchiveChatMessage,
    resetForLogout,
  };
});
