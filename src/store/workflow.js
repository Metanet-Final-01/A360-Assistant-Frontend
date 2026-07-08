import { reactive } from "vue";
import { uploadDocument, parseDocument, createDocumentFromText } from "../api/documents";
import { chatStream } from "../api/agent";
import { analyzeSession } from "../api/analysis";
import { recommendSession, listRecommendations, saveRecommendation } from "../api/recommend";
import { createSession } from "../api/sessions";
import { register as apiRegister, login as apiLogin, getMe } from "../api/auth";
import { ApiError, getToken, setToken, clearToken } from "../api/http";

// NOTE: 분석(/api/sessions/{id}/analyze)·추천/흐름도(/api/sessions/{id}/recommend 등, RPA-61)·
// 멀티턴 챗(/api/agent/chat[/stream], session_id)·업로드/파싱/텍스트 입력(RPA-42/43/44)은
// 전부 실제 백엔드와 연동되어 있다. workflow.recommendation.recommendation이 흐름도
// 트리(steps→actions→children) 원본이고, FlowModal이 이를 렌더·편집한다 — 수정은 항상
// 새 버전 저장(POST .../recommendations)이라 실행취소는 프론트가 들고 있는 이전 트리를
// 다시 저장하는 것으로 구현한다(workflow.recommendUndoStack).

export function evidenceLabel(evidence) {
  if (!evidence) return "";
  const page = evidence.page != null ? `p.${evidence.page}` : "";
  const snippet = evidence.snippet ? `«${evidence.snippet}»` : "";
  return [page, snippet].filter(Boolean).join(" ");
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

function createInitialChatMessages() {
  return [{ role: "assistant", text: GREETING, time: nowTime() }];
}

function createArchiveSessions() {
  return ARCHIVE_SEED_SESSIONS.map((seed) => ({
    id: makeId("chat"),
    title: seed.title,
    dateLabel: seed.dateLabel,
    messages: seed.messages.map((message) => ({ ...message })),
  }));
}

// 아카이브 > 분석 결과 탭에 표시할 샘플 분석 결과 목록 (결과 조회/보관 API가 아직 없어
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
    summary:
      "고객센터에 접수된 문의를 티켓 시스템에 등록하고 담당자에게 배정한 뒤 처리 결과를 이메일로 회신하는 업무입니다.",
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
  }));
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

  // 분석 상태 (POST /api/sessions/{id}/analyze)
  analysisStatus: "idle", // idle | analyzing | done | error
  analysisStage: "", // 진행 중 stage 이벤트의 표시용 문구
  analysisError: "",
  analysis: null, // done.data 원본: { analysis_id, document_title, summary, steps, ambiguities }

  // 흐름도(추천안) 상태 (POST /api/sessions/{id}/recommend 등, RPA-61)
  recommendStatus: "idle", // idle | generating | done | error
  recommendStage: "",
  recommendError: "",
  recommendation: null, // { id, version, parent_version, source, change_summary, created_at, recommendation: {schema_version, steps, variables, notes} }
  recommendVersions: [], // GET .../recommendations 메타 목록 (최신 순, 트리 내용은 없음)
  recommendUndoStack: [], // 편집 직전 트리 스냅샷들 — 실행취소 시 pop해서 다시 저장

  // 챗봇 상태
  chatOpen: false,
  chatDocked: true,
  chatMessages: createInitialChatMessages(),

  // 아카이브 > 챗봇 상태 (대화 기록 목록 + 상세 대화)
  archiveSessions: createArchiveSessions(),
  activeArchiveSessionId: null,

  // 아카이브 > 분석 결과 상태 (결과 목록 + 선택된 결과 상세)
  archiveResults: createArchiveResults(),
  activeArchiveResultId: null,
});
workflow.activeArchiveSessionId = workflow.archiveSessions[0]?.id ?? null;
workflow.activeArchiveResultId = workflow.archiveResults[0]?.id ?? null;

let timers = [];
function clearTimers() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

const ALLOWED_EXT = ["pdf", "pptx", "ppt", "docx"];

// 새 문서/텍스트 요청을 시작할 때 이전 분석·추천 결과를 전부 지운다 (새 세션 기준으로 다시 쌓임)
function resetPipelineState() {
  workflow.document = null;
  workflow.analysisStatus = "idle";
  workflow.analysisStage = "";
  workflow.analysisError = "";
  workflow.analysis = null;
  workflow.recommendStatus = "idle";
  workflow.recommendStage = "";
  workflow.recommendError = "";
  workflow.recommendation = null;
  workflow.recommendVersions = [];
  workflow.recommendUndoStack = [];
}

export async function selectFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    workflow.uploadStatus = "error";
    workflow.uploadError = "PDF · PPT · PPTX · DOCX 파일만\n업로드할 수 있습니다.";
    return;
  }

  clearTimers();
  workflow.uploadError = "";
  workflow.file = { name: file.name, size: file.size, ext };
  workflow.uploadStatus = "uploading";
  resetPipelineState();

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
      workflow.uploadStatus = "uploaded";
      return;
    }

    // status === "uploaded" — 업로드와 파싱이 분리되어 있어 이어서 SSE로 파싱을 진행해야
    // document.status가 "parsed"가 되고 분석 시작 버튼이 활성화된다.
    await parseDocument(document.id, {
      onDone: (data) => {
        workflow.document = data;
        workflow.uploadStatus = "uploaded";
      },
      onError: (message) => {
        workflow.uploadStatus = "error";
        workflow.uploadError = message;
      },
    });
  } catch (err) {
    workflow.uploadStatus = "error";
    workflow.uploadError =
      err instanceof ApiError ? err.message : "업로드 중 알 수 없는 오류가 발생했습니다.";
  }
}

// 파일 없이 자연어로 업무를 설명해 곧장 분석 단계로 들어간다 (RPA-43). 파싱이 필요 없어
// 응답이 바로 status="parsed"로 온다 — parseDocument() 호출이 필요 없다.
export async function submitTextRequest(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  clearTimers();
  workflow.uploadError = "";
  workflow.file = { name: "텍스트 입력", size: trimmed.length, ext: "txt" };
  workflow.uploadStatus = "uploading";
  resetPipelineState();

  try {
    const document = await createDocumentFromText(trimmed, workflow.sessionId);
    workflow.sessionId = document.session_id;
    workflow.document = document;
    workflow.uploadStatus = document.status === "failed" ? "error" : "uploaded";
    if (document.status === "failed") {
      workflow.uploadError = document.error || "요청을 처리하지 못했습니다.";
    }
  } catch (err) {
    workflow.uploadStatus = "error";
    workflow.uploadError =
      err instanceof ApiError ? err.message : "요청 처리 중 알 수 없는 오류가 발생했습니다.";
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
  // 새 분석은 이전 추천안(흐름도)을 무효화한다 — 다른 분석 결과에 종속된 트리라 이어 쓸 수 없다
  workflow.recommendStatus = "idle";
  workflow.recommendStage = "";
  workflow.recommendError = "";
  workflow.recommendation = null;
  workflow.recommendVersions = [];
  workflow.recommendUndoStack = [];

  await analyzeSession(workflow.sessionId, {
    onStage: (message) => {
      workflow.analysisStage = message;
    },
    onDone: (data) => {
      workflow.analysis = data;
      workflow.analysisStatus = "done";
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

// 흐름도(추천안) 생성 — 최신 분석 결과 기준으로 A360 액션 트리를 만들어 v1로 저장한다 (RPA-61)
export async function startRecommend() {
  if (
    workflow.analysisStatus !== "done" ||
    !workflow.sessionId ||
    workflow.recommendStatus === "generating"
  ) {
    return;
  }
  workflow.recommendStatus = "generating";
  workflow.recommendStage = "";
  workflow.recommendError = "";

  await recommendSession(workflow.sessionId, {
    onStage: (message) => {
      workflow.recommendStage = message;
    },
    onDone: (data) => {
      workflow.recommendation = data;
      workflow.recommendStatus = "done";
      workflow.recommendUndoStack = [];
      loadRecommendationHistory();
    },
    onError: (code, message) => {
      workflow.recommendStatus = "error";
      workflow.recommendError =
        code === "AGENT_UNAVAILABLE"
          ? "추천 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
          : message || "추천안 생성 중 오류가 발생했습니다.";
    },
  });
}

export async function loadRecommendationHistory() {
  if (!workflow.sessionId) return;
  try {
    const { versions } = await listRecommendations(workflow.sessionId);
    workflow.recommendVersions = versions;
  } catch {
    // 버전 이력 조회 실패는 핵심 기능이 아니므로 조용히 무시
  }
}

async function persistRecommendationTree(tree, changeSummary, source) {
  try {
    const saved = await saveRecommendation(workflow.sessionId, {
      recommendation: tree,
      parentVersion: workflow.recommendation?.version,
      source,
      changeSummary,
    });
    workflow.recommendation = { ...saved, recommendation: tree };
    loadRecommendationHistory();
  } catch (err) {
    workflow.recommendError =
      err instanceof ApiError ? err.message : "추천안 저장 중 오류가 발생했습니다.";
  }
}

// FlowModal에서 드래그/수정/삭제로 트리를 바꾼 뒤 호출 — 항상 새 버전으로 저장한다(수정=UPDATE 아님).
export async function saveRecommendationEdit(newTree, changeSummary) {
  if (!workflow.sessionId || !workflow.recommendation) return;
  workflow.recommendUndoStack.push(JSON.parse(JSON.stringify(workflow.recommendation.recommendation)));
  await persistRecommendationTree(newTree, changeSummary ?? null, "drag");
}

// 직전 트리 스냅샷을 다시 저장해서 "취소"한다 — 백엔드엔 삭제가 없고 항상 새 버전만 쌓인다.
export async function undoRecommendationEdit() {
  if (!workflow.sessionId || workflow.recommendUndoStack.length === 0) return;
  const previous = workflow.recommendUndoStack.pop();
  await persistRecommendationTree(previous, "실행 취소", "drag");
}

export function resetUpload() {
  clearTimers();
  workflow.file = null;
  workflow.uploadStatus = "idle";
  workflow.uploadError = "";
  workflow.sessionId = null;
  resetPipelineState();
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
// 문서 업로드로 이미 세션이 있으면 그 세션에, 없으면 챗 전용 빈 세션을 만들어 이어서 쓴다.
// 이렇게 하면 이 위젯의 대화가 항상 같은 session_id로 유지되어 백엔드가 멀티턴 이력을 쌓는다.
async function ensureChatSessionId() {
  if (workflow.sessionId) return workflow.sessionId;
  try {
    const { session_id } = await createSession();
    workflow.sessionId = session_id;
  } catch {
    // 세션 생성 실패 시 무상태로 폴백 — session_id 없이 보내면 백엔드가 그냥 단발로 처리한다
  }
  return workflow.sessionId;
}

export async function sendChatMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  workflow.chatMessages.push({ role: "user", text: trimmed, time: nowTime() });

  const assistantMessage = reactive({ role: "assistant", text: "", time: nowTime() });
  workflow.chatMessages.push(assistantMessage);

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

export function selectArchiveResult(id) {
  workflow.activeArchiveResultId = id;
}

export function renameArchiveResult(id, title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  const result = workflow.archiveResults.find((r) => r.id === id);
  if (result) result.title = trimmed;
}

export function deleteArchiveResult(id) {
  const idx = workflow.archiveResults.findIndex((r) => r.id === id);
  if (idx === -1) return;
  workflow.archiveResults.splice(idx, 1);
  if (workflow.activeArchiveResultId === id) {
    workflow.activeArchiveResultId = workflow.archiveResults[0]?.id ?? null;
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

export function buildExportPayload() {
  return {
    document: workflow.file?.name ?? null,
    generatedAt: new Date().toISOString(),
    analysis: workflow.analysis,
    recommendation: workflow.recommendation?.recommendation ?? null,
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
  resetUpload();
  clearToken();
  workflow.isLoggedIn = false;
  workflow.userEmail = null;
  workflow.chatOpen = false;
  workflow.chatMessages = createInitialChatMessages();
  workflow.archiveSessions = createArchiveSessions();
  workflow.activeArchiveSessionId = workflow.archiveSessions[0]?.id ?? null;
  workflow.archiveResults = createArchiveResults();
  workflow.activeArchiveResultId = workflow.archiveResults[0]?.id ?? null;
}
