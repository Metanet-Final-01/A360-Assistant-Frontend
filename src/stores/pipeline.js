import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { uploadDocument, parseDocument, createDocumentFromText } from "../api/documents";
import { turnStream } from "../api/agent";
import { listRecommendations, saveRecommendation, getLatestRecommendation } from "../api/recommend";
import { getLatestAnalysis } from "../api/sessions";
import { ApiError } from "../api/http";
import { useChatStore } from "./chat";
import { useArchiveStore } from "./archive";
import { useSettingsStore } from "./settings";
import { formatTime } from "../utils/dateFormat";
import { createTypewriter } from "../utils/typewriter";
import { t } from "../i18n";

// NOTE: 분석·추천 생성은 에이전트 단일 진입점 POST /api/sessions/{id}/turn으로 통합됐다
// (RPA-64/67 — 레거시 /analyze·/recommend는 제거). 버튼은 합성 메시지를 보내고, done.data의
// 산출물 필드(analysis_result/recommendation)를 보고 상태를 갱신한다(applyTurnArtifacts —
// 챗에서 만들어진 분석/흐름도도 같은 경로로 반영된다).
// recommendation.recommendation이 흐름도 트리(steps→actions→children) 원본이다.
// 사용자 편집은 업로드 패널의 업무 단계 카드(analysis.steps, WorkStep[])에서 하고,
// "흐름도에 저장" 버튼이 그 편집(순서/삭제/추가)을 추천 트리에 step_id 기준으로 투영해
// 새 버전으로 저장한다(applyAnalysisEditsToFlow → POST .../recommendations, 호출마다 무조건
// 새 버전 INSERT). RecommendationFlowModal은 읽기 전용 보기 + 버전 이력이다.
// 백엔드에 개별 버전 조회 API가 없어 실행취소·버전 되돌리기는 프론트가 들고 있는
// 트리(recommendUndoStack·recommendTreesByVersion)를 다시 저장하는 것으로 구현한다.

const ALLOWED_EXT = ["pdf", "pptx", "ppt", "docx"];

export const usePipelineStore = defineStore("pipeline", () => {
  // 업로드 상태
  const file = ref(null); // { name, size, ext }
  const uploadStatus = ref("idle"); // idle | uploading | uploaded | error
  const uploadError = ref("");
  const sessionId = ref(null); // 이후 분석/추천/챗봇 API의 키
  const document = ref(null); // POST /api/documents 응답 원본 (id, status, page_count, warnings, error 등)

  // 분석 상태 (POST /api/sessions/{id}/turn, done.data.analysis_result)
  const analysisStatus = ref("idle"); // idle | analyzing | done | error
  const analysisStage = ref(""); // 진행 중 stage 이벤트의 표시용 문구
  const analysisError = ref("");
  const analysis = ref(null); // analysis_result + analysis_id: { analysis_id, document_title, summary, steps, ambiguities }

  // 흐름도(추천안) 상태 (생성: /turn, 버전 저장·조회: /recommendations REST — RPA-61 유지)
  const recommendStatus = ref("idle"); // idle | generating | done | error
  const recommendStage = ref("");
  const recommendError = ref("");
  const recommendation = ref(null); // { id, version, parent_version, source, change_summary, created_at, recommendation: {schema_version, steps, variables, notes} }
  const recommendVersions = ref([]); // GET .../recommendations 메타 목록 (최신 순, 트리 내용은 없음)
  const recommendUndoStack = ref([]); // 편집 직전 트리 스냅샷들 — 실행취소 시 pop해서 다시 저장
  const recommendTreesByVersion = ref({}); // 이 세션에서 확보한 버전별 트리 캐시 — 버전 이력 "되돌리기"의 원본 (백엔드엔 개별 버전 조회 API가 없다)
  const recommendSaveError = ref(""); // 편집/실행취소 저장 실패 시 메시지 — done 화면은 유지한 채 이 메시지만 보여준다

  // 매 /turn done.data.usage_gauge — 이 세션의 대화 누적 게이지 (RPA-83).
  // { intake_tokens, limit_tokens, ratio(0~1+), compact_recommended, compact_required }
  // 챗 위젯이 링 게이지로 표시하고, compact_recommended면 "대화 압축" 버튼을 강조한다.
  const usageGauge = ref(null);

  // 사이드바에서 과거 세션을 선택해 분석·흐름도·채팅 이력을 통째로 불러오는 동안의 상태
  // (loadSession 전용 — analysisStatus/recommendStatus는 이 fetch 동안 idle로 리셋돼 있어
  // 별도 플래그가 없으면 UI가 "로딩 중"과 "빈 화면"을 구분할 수 없다). 사이드바·업로드
  // 패널·흐름도 패널·챗 위젯이 이 값을 보고 로딩 스피너를 표시한다.
  const sessionLoadStatus = ref("idle"); // idle | loading | error

  // 라이브 흐름도 스트리밍 상태 (RPA — 스트리밍 흐름도). 백엔드가 흐름도 생성/수정 도중 partial
  // 이벤트로 흘려보내는 flow 스냅샷을 프레임 단위로 담고, "추천 흐름도 상세" 패널이 이걸
  // 인라인으로 실시간 렌더한다(모달 팝업 아님). 버튼(startRecommend)·분석(startAnalysis)·
  // 챗(sendTurn) 어느 경로로 흐름도를 만들든 같은 상태를 갱신한다.
  // liveActive는 "이 턴에 흐름도 스트림이 진행 중"이라는 뜻 — 첫 프레임에서 켜지고 done/error에
  // 리셋된다. 리셋되면 패널은 저장된 최종 추천안(pipeline.recommendation)을 보여준다(그래야
  // 버전 되돌리기·편집도 반영된다).
  const liveFlow = ref(null); // 최신 스냅샷 { steps, variables, notes }
  const liveViolations = ref([]); // 스냅샷의 검수 위반 (노드 강조용)
  const liveCaption = ref(""); // "검수 · 위반 N건" / "완료" 등 프레임 캡션
  const liveActive = ref(false); // 스트림 진행 중 여부 (첫 프레임에서 켜짐)
  const liveActiveStep = ref(null); // 지금 국소 수정 중인 step_id — 그 단계를 붉게 강조·스크롤
  // 라이브 분석 스냅샷(kind:"analysis") — 흐름도와 같은 partial 채널을 쓰되 분석 결과 전용.
  // 분석 스트리밍 중 업로드 패널이 이걸 인라인 렌더한다(요약 → 단계 하나씩 채워짐).
  const liveAnalysis = ref(null); // { summary, document_title, steps, ambiguities }
  // v3 품질 루프 국면 스냅샷 — 후보 생성/심판/검증 요약을 담는 진행 카드용 상태.
  // 모르는 kind는 여전히 무시된다(하위호환) — v2 백엔드에선 이 값들이 늘 null이다.
  const liveSpec = ref(null); // FlowSpec { goal, requirements[] ... } — 요구 정형화 진행
  const liveCandidates = ref(null); // [{id, persona, status, steps, actions}] — 후보 요약 카드
  const liveVerdict = ref(null); // {winner, reason, scores[]} — 심판 점수판
  const liveScorecard = ref(null); // {must_coverage, blockers, sim_pass_rate, cards, flow_confidence}

  // partial 프레임 하나를 반영한다 — kind로 프레임 종류를 가른다. 프레임마다 패널이 다시 그린다.
  function applyLiveFrame(data) {
    if (!data) return;
    if (data.kind === "analysis") {
      liveAnalysis.value = data.analysis ?? null; // 분석 라이브 스냅샷 — 업로드 패널이 렌더
      return;
    }
    if (data.kind === "spec") {
      liveSpec.value = data.spec ?? null;
      liveActive.value = true; // 품질 루프 시작 — 패널이 진행 카드를 보여준다
      liveCaption.value = data.caption ?? "";
      return;
    }
    if (data.kind === "candidates") {
      liveCandidates.value = data.candidates ?? null;
      liveActive.value = true;
      liveCaption.value = data.caption ?? "";
      return;
    }
    if (data.kind === "verdict") {
      liveVerdict.value = data.verdict ?? null;
      liveCaption.value = data.caption ?? "";
      return;
    }
    if (data.kind === "scorecard") {
      liveScorecard.value = data.scorecard ?? null;
      liveCaption.value = data.caption ?? "";
      return;
    }
    if (data.kind !== "flow") return;
    liveActive.value = true;
    liveCandidates.value = null; // 승자 확정 이후엔 후보 카드 대신 트리 라이브 렌더
    liveFlow.value = data.flow ?? { steps: [] };
    liveViolations.value = data.violations ?? [];
    liveCaption.value = data.caption ?? "";
    liveActiveStep.value = data.active_step_id ?? null; // 수정 중 아니면 null → 강조 해제
  }

  function resetLiveFlow() {
    liveActive.value = false;
    liveFlow.value = null;
    liveViolations.value = [];
    liveCaption.value = "";
    liveActiveStep.value = null;
    liveAnalysis.value = null;
    liveSpec.value = null;
    liveCandidates.value = null;
    liveVerdict.value = null;
    liveScorecard.value = null;
  }

  let timers = [];
  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  // 진행 중인 /turn 스트림(분석·추천·챗 공통)은 세션 전환 등으로 무효화되면 실제로
  // 끊어야 한다 — 그냥 무시만 하면 늦게 도착한 이전 세션의 done이 지금 화면의 분석/추천을
  // 덮어쓸 수 있다(applyTurnArtifacts의 세션 가드가 2차 방어선). chat.js의 sendTurn도
  // 같은 컨트롤러를 공유해서, 챗 메시지 전송이 진행 중인 분석/추천 턴을 취소하고
  // 그 반대도 마찬가지로 동작한다 — 세션당 턴은 항상 하나만 살아있게 한다.
  let activeTurnController = null;
  function startTurnController() {
    activeTurnController?.abort();
    activeTurnController = new AbortController();
    return activeTurnController.signal;
  }
  function cancelActiveTurn() {
    activeTurnController?.abort();
    activeTurnController = null;
  }

  // 업로드/텍스트 요청도 비동기 응답 도중 새 업로드나 초기화가 시작되면 늦게 온 응답이
  // 지금 상태를 덮어쓸 수 있다 — 매 시도마다 세대를 올리고, 응답이 왔을 때 그 사이 세대가
  // 바뀌지 않았는지 확인한다(loadSession의 sessionId 가드와 같은 패턴). 세대 가드는 상태
  // 반영만 막을 뿐 네트워크 요청 자체는 계속 흐르므로, 실제로 끊기 위해 turnController와
  // 같은 방식의 AbortController도 함께 둔다.
  let uploadGeneration = 0;
  function nextUploadGeneration() {
    uploadGeneration += 1;
    return uploadGeneration;
  }

  // sessionId만으로는 "다른 세션으로 갔다가 같은 세션으로 돌아온" 반복 로드를 구분할 수 없다
  // (A→B→A처럼 재진입하면 sessionId.value가 다시 A와 같아져 오래된 응답도 최신으로 오인된다) —
  // loadSession마다 세대를 올리고 그 세대를 loadHistoryMessages까지 넘겨 시도 단위로 구분한다.
  const sessionGeneration = ref(0);
  function nextSessionGeneration() {
    sessionGeneration.value += 1;
    return sessionGeneration.value;
  }

  // persistRecommendationTree()는 turnStream처럼 AbortController로 끊을 수 있는 SSE가 아니라
  // 평범한 REST POST라 요청 자체는 계속 흐른다 — 세션은 그대로인 채 startAnalysis()가 추천
  // 상태를 초기화한 뒤에 늦게 도착한 저장 응답이 그 초기화를 덮어쓰지 않도록 세대로 구분한다
  // (세션 자체가 바뀐 경우는 sessionId 비교로 충분히 잡힌다).
  let recommendGeneration = 0;

  let activeUploadController = null;
  function startUploadController() {
    activeUploadController?.abort();
    activeUploadController = new AbortController();
    return activeUploadController.signal;
  }
  function cancelActiveUpload() {
    activeUploadController?.abort();
    activeUploadController = null;
  }

  // 새 문서/텍스트 요청을 시작할 때 이전 분석·추천 결과를 전부 지운다 (새 세션 기준으로 다시 쌓임)
  function resetPipelineState() {
    document.value = null;
    analysisStatus.value = "idle";
    analysisStage.value = "";
    analysisError.value = "";
    analysis.value = null;
    recommendStatus.value = "idle";
    recommendStage.value = "";
    recommendError.value = "";
    recommendation.value = null;
    recommendVersions.value = [];
    recommendUndoStack.value = [];
    recommendTreesByVersion.value = {};
    recommendSaveError.value = "";
    analysisEditSummaries.value = [];
    resetLiveFlow();
  }

  async function selectFile(inputFile) {
    // 챗 턴이 진행 중이면 여기서 cancelActiveTurn()으로 그 스트림을 끊지 않는다 — 끊긴 챗
    // 턴은 onDone/onError 없이 끝나 말풍선이 "응답 중" 상태로 영영 멈춰버린다(RPA-107).
    // 챗이 끝난 뒤 다시 시도하게 한다 — UI도 이 조건일 때 업로드를 막아야 한다(최종 방어선).
    if (useChatStore().isSending) return;
    const ext = inputFile.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      uploadStatus.value = "error";
      uploadError.value = t("pipeline.errors.invalidFileType");
      return;
    }

    clearTimers();
    uploadError.value = "";
    file.value = { name: inputFile.name, size: inputFile.size, ext };
    uploadStatus.value = "uploading";
    resetPipelineState();
    cancelActiveTurn();
    const myGeneration = nextUploadGeneration();
    const signal = startUploadController();

    try {
      const doc = await uploadDocument(inputFile, sessionId.value, { signal });
      if (myGeneration !== uploadGeneration) return; // 그 사이 새 업로드/초기화가 시작됨
      sessionId.value = doc.session_id;
      document.value = doc;

      if (doc.status === "failed") {
        uploadStatus.value = "error";
        uploadError.value = doc.error || t("api.errors.parseFailed");
        return;
      }

      if (doc.status === "parsed") {
        uploadStatus.value = "uploaded";
        return;
      }

      // status === "uploaded" — 업로드와 파싱이 분리되어 있어 이어서 SSE로 파싱을 진행해야
      // document.status가 "parsed"가 되고 분석 시작 버튼이 활성화된다.
      await parseDocument(doc.id, {
        signal,
        onDone: (data) => {
          if (myGeneration !== uploadGeneration) return;
          document.value = data;
          uploadStatus.value = "uploaded";
        },
        onError: (message) => {
          if (myGeneration !== uploadGeneration) return;
          uploadStatus.value = "error";
          uploadError.value = message;
        },
      });
    } catch (err) {
      if (err?.name === "AbortError") return; // 새 업로드/초기화로 의도적으로 취소됨
      if (myGeneration !== uploadGeneration) return;
      uploadStatus.value = "error";
      uploadError.value =
        err instanceof ApiError ? err.message : t("pipeline.errors.uploadUnknown");
    }
  }

  // 파일 없이 자연어로 업무를 설명해 곧장 분석 단계로 들어간다 (RPA-43). 파싱이 필요 없어
  // 응답이 바로 status="parsed"로 온다 — parseDocument() 호출이 필요 없다.
  async function submitTextRequest(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // 챗 턴 진행 중엔 취소하지 않고 거부한다 — selectFile()과 동일한 이유(RPA-107)
    if (useChatStore().isSending) return;

    clearTimers();
    uploadError.value = "";
    file.value = { name: t("pipeline.textInputLabel"), size: trimmed.length, ext: "txt" };
    uploadStatus.value = "uploading";
    resetPipelineState();
    cancelActiveTurn();
    const myGeneration = nextUploadGeneration();
    const signal = startUploadController();

    try {
      const doc = await createDocumentFromText(trimmed, sessionId.value, { signal });
      if (myGeneration !== uploadGeneration) return; // 그 사이 새 업로드/초기화가 시작됨
      sessionId.value = doc.session_id;
      document.value = doc;
      uploadStatus.value = doc.status === "failed" ? "error" : "uploaded";
      if (doc.status === "failed") {
        uploadError.value = doc.error || t("pipeline.errors.textRequestFailed");
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // 새 업로드/초기화로 의도적으로 취소됨
      if (myGeneration !== uploadGeneration) return;
      uploadStatus.value = "error";
      uploadError.value =
        err instanceof ApiError ? err.message : t("pipeline.errors.textRequestUnknown");
    }
  }

  // /turn done.data에 실려 온 산출물을 상태에 반영한다 — 버튼발 턴이든 챗발 턴이든 공통.
  // 백엔드가 type과 무관하게 non-null 산출물을 전부 저장하므로("분석 없이 바로 흐름도" 턴은
  // 분석+흐름도가 같이 온다) 프론트도 필드 존재 여부로 반영한다.
  function applyTurnArtifacts(data) {
    if (!data) return;
    // 이 턴을 시작한 뒤 다른 세션으로 넘어갔으면(사이드바에서 세션 전환 등) 늦게 도착한
    // 결과다 — 지금 화면과 무관한 분석/추천으로 덮어쓰지 않도록 버린다. startTurnController로
    // 세션 전환 시 스트림 자체를 끊긴 하지만, 끊기 직전에 이미 도착한 done 이벤트가 있을 수
    // 있어(네트워크 타이밍) 이 가드가 최종 방어선이다.
    if (data.session_id && data.session_id !== sessionId.value) return;
    // 모든 턴(챗/분석/추천/압축)이 이 함수를 거치므로, 새 세션이 생기거나 제목·갱신시각이
    // 바뀔 때마다 사이드바 세션 이력도 함께 최신화한다.
    useArchiveStore().loadSessions();
    if (data.usage_gauge) usageGauge.value = data.usage_gauge;
    if (data.analysis_result) {
      analysis.value = { ...data.analysis_result, analysis_id: data.analysis_id ?? null };
      analysisStatus.value = "done";
      analysisError.value = "";
      analysisEditSummaries.value = []; // 새 분석본이 로컬 편집을 통째로 대체했다 — 반영 안 된 편집은 무효
    }
    if (data.recommendation) {
      recommendation.value = {
        id: data.id,
        version: data.version,
        parent_version: data.parent_version,
        source: data.source,
        change_summary: data.change_summary,
        created_at: data.created_at,
        recommendation: data.recommendation,
      };
      recommendStatus.value = "done";
      recommendError.value = "";
      recommendTreesByVersion.value[data.version] = JSON.parse(JSON.stringify(data.recommendation));
      loadRecommendationHistory();
    }
  }

  // 분석 시작 버튼 — intent 필드가 없으므로 합성 메시지로 에이전트의 분석 브랜치를 태운다
  // ⚠️ 번역 금지: 이 문자열은 화면 표시뿐 아니라 그대로 백엔드 /turn API에 전송되어 에이전트의
  // 분석/추천 라우팅을 태우는 트리거 문자열이다(intent 필드 없음, 리터럴 매칭 가능성). 영어 UI에서도
  // 한국어 그대로 전송해야 하며, 다국어 트리거 지원은 백엔드 팀과 별도 협의 필요(이번 프론트 i18n
  // 작업 범위 밖).
  const ANALYZE_MESSAGE = "이 업무정의서를 분석해서 자동화 흐름도까지 만들어줘";
  // 추천안 생성 버튼 합성 메시지 (작업 명세의 문구 그대로) — 위와 동일한 이유로 번역 금지.
  const RECOMMEND_MESSAGE = "이 업무정의서로 자동화 흐름도 만들어줘";

  // 분석/추천 버튼도 결국 /turn에 합성 메시지를 보내는 것뿐이라, 챗과 똑같이 사용자 턴으로
  // 챗봇 화면에 남긴다 — 버튼으로 시작했든 챗으로 시작했든 같은 세션 대화 흐름으로 보이게.
  function pushChatTurn(message) {
    const chat = useChatStore();
    chat.chatMessages.push({ role: "user", text: message, time: formatTime() });
    // stages: 이 턴 동안 받은 진행 상태 메시지 이력 — 말풍선 위 작은 텍스트를 누르면 펼쳐 보여준다.
    // stagesDone: 턴이 끝난 뒤에도 마지막 상태가 "완료" 문구로 남도록 표시한다.
    const assistantMessage = reactive({
      role: "assistant",
      text: "",
      stages: [],
      stagesOpen: false,
      stagesDone: false,
      time: formatTime(),
    });
    chat.chatMessages.push(assistantMessage);
    return assistantMessage;
  }

  async function startAnalysis() {
    if (document.value?.status !== "parsed" || !sessionId.value || analysisStatus.value === "analyzing") {
      return;
    }
    // 챗 턴 진행 중엔 취소하지 않고 거부한다 — selectFile()과 동일한 이유(RPA-107)
    if (useChatStore().isSending) return;
    analysisStatus.value = "analyzing";
    analysisStage.value = "";
    analysisError.value = "";
    analysis.value = null;
    // 새 분석은 이전 추천안(흐름도)을 무효화한다 — 다른 분석 결과에 종속된 트리라 이어 쓸 수 없다
    recommendStatus.value = "idle";
    recommendStage.value = "";
    recommendError.value = "";
    recommendation.value = null;
    recommendVersions.value = [];
    recommendUndoStack.value = [];
    recommendTreesByVersion.value = {};
    recommendSaveError.value = "";
    recommendGeneration += 1;
    analysisEditSummaries.value = []; // 새 분석이 편집 대상 자체를 갈아치운다 — 반영 안 된 편집은 무효
    resetLiveFlow(); // 이전 라이브 스냅샷 정리 — 이 턴이 흐름도까지 만들면 첫 partial에서 다시 켜진다

    const assistantMessage = pushChatTurn(ANALYZE_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);
    // signal.aborted를 콜백마다 확인한다 — cancelActiveTurn()이 fetch/reader를 끊어도, 이미
    // 버퍼에 도착해 있던 프레임(예: done)은 abort 이후에도 동기적으로 마저 처리될 수 있어
    // (스트림 구현체 타이밍 문제) 세션이 그대로여도 취소된 턴의 결과가 새로 지운 상태를
    // 다시 채울 수 있다 — 이 턴 소유권 검사가 최종 방어선이다.
    const signal = startTurnController();
    // chat.js의 sendTurn과 동일한 이유 — 버전 복원(loadAgentVersions)이 끝나기 전에 나가면
    // 저장된 선택 대신 백엔드 기본값으로 보내진다.
    await useSettingsStore().loadAgentVersions();

    await turnStream(sessionId.value, ANALYZE_MESSAGE, {
      agentVersion: useSettingsStore().agentVersion, // 설정에서 고른 버전 — null이면 필드 생략(백엔드 기본)
      signal,
      onStage: (message) => {
        if (signal.aborted) return;
        analysisStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onPartial: (data) => {
        if (signal.aborted) return;
        // 분석+흐름도까지 만드는 턴이라 생성 단계의 flow 스냅샷이 여기로 온다 — 라이브 렌더
        applyLiveFrame(data);
      },
      onToken: (token) => {
        if (signal.aborted) return;
        typewriter.push(token);
      },
      onDone: (data) => {
        if (signal.aborted) return;
        applyTurnArtifacts(data);
        resetLiveFlow(); // 스트림 종료 → 패널이 저장된 최종본을 보여준다
        if (!data?.analysis_result) {
          // 에이전트가 분석 대신 일반 답변으로 흐른 경우 — 성공 done이어도 분석 산출물이 없다
          analysisStatus.value = "error";
          analysisError.value = data?.answer || t("pipeline.errors.analysisNoResult");
        }
        // 분석 노드는 token 스트림 없이 done에만 answer가 실린다 — 타자기 큐로 흘려보낸다.
        if (typewriter.started) {
          typewriter.finish();
        } else {
          typewriter.push(data?.answer || (data?.analysis_result ? t("pipeline.messages.analysisDone") : analysisError.value));
        }
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(data?.analysis_result ? t("pipeline.stage.analysisDone") : t("pipeline.stage.analysisFailed"));
          assistantMessage.stagesDone = true;
        }
      },
      onError: (code, message) => {
        if (signal.aborted) return;
        typewriter.finish();
        resetLiveFlow(); // 실패 시 라이브 모달 닫기
        analysisStatus.value = "error";
        analysisError.value =
          code === "AGENT_UNAVAILABLE"
            ? t("pipeline.errors.analysisEngineUnavailable")
            : message || t("pipeline.errors.analysisGeneric");
        assistantMessage.text = assistantMessage.text
          ? `${assistantMessage.text}\n\n⚠ ${analysisError.value}`
          : `⚠ ${analysisError.value}`;
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(t("common.stageAborted"));
          assistantMessage.stagesDone = true;
        }
      },
    });
  }

  // 흐름도(추천안) 생성 버튼 — 합성 메시지 턴. 생성본은 백엔드가 새 버전으로 저장까지 한다.
  async function startRecommend() {
    if (analysisStatus.value !== "done" || !sessionId.value || recommendStatus.value === "generating") {
      return;
    }
    // 챗 턴 진행 중엔 취소하지 않고 거부한다 — selectFile()과 동일한 이유(RPA-107)
    if (useChatStore().isSending) return;
    recommendStatus.value = "generating";
    recommendStage.value = "";
    recommendError.value = "";
    recommendSaveError.value = "";
    resetLiveFlow(); // 이전 라이브 스냅샷 정리 — 첫 partial 프레임에서 다시 켜진다

    const assistantMessage = pushChatTurn(RECOMMEND_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);
    // startAnalysis()와 동일한 이유(RPA-107) — 취소된 턴의 늦게 처리된 콜백이 방금 지운
    // 추천 상태를 다시 채우지 않도록 콜백마다 signal.aborted를 확인한다.
    const signal = startTurnController();
    // startAnalysis()와 동일한 이유 — 버전 복원이 끝나기 전에 나가지 않도록 기다린다.
    await useSettingsStore().loadAgentVersions();

    await turnStream(sessionId.value, RECOMMEND_MESSAGE, {
      agentVersion: useSettingsStore().agentVersion, // 설정에서 고른 버전 — null이면 필드 생략(백엔드 기본)
      signal,
      onStage: (message) => {
        if (signal.aborted) return;
        recommendStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onPartial: (data) => {
        if (signal.aborted) return;
        applyLiveFrame(data); // 흐름도 스냅샷 프레임 — 추천 흐름도 상세 패널이 실시간 렌더
      },
      onToken: (token) => {
        if (signal.aborted) return;
        typewriter.push(token);
      },
      onDone: (data) => {
        if (signal.aborted) return;
        if (data?.recommendation) recommendUndoStack.value = []; // 새 생성 기준으로 실행취소 초기화
        applyTurnArtifacts(data);
        resetLiveFlow(); // 스트림 종료 → 패널이 저장된 최종본을 보여준다(버전 되돌리기·편집 반영)
        if (!data?.recommendation) {
          recommendStatus.value = "error";
          recommendError.value = data?.answer || t("pipeline.errors.recommendNoResult");
        }
        // 추천 노드도 token 스트림 없이 done에만 answer가 실린다 — 타자기 큐로 흘려보낸다.
        if (typewriter.started) {
          typewriter.finish();
        } else {
          typewriter.push(data?.answer || (data?.recommendation ? t("pipeline.messages.recommendDone") : recommendError.value));
        }
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(data?.recommendation ? t("pipeline.stage.recommendDone") : t("pipeline.stage.recommendFailed"));
          assistantMessage.stagesDone = true;
        }
      },
      onError: (code, message) => {
        if (signal.aborted) return;
        typewriter.finish();
        resetLiveFlow(); // 실패 시 라이브 모달 닫기
        recommendStatus.value = "error";
        recommendError.value =
          code === "AGENT_UNAVAILABLE"
            ? t("pipeline.errors.recommendEngineUnavailable")
            : message || t("pipeline.errors.recommendGeneric");
        assistantMessage.text = assistantMessage.text
          ? `${assistantMessage.text}\n\n⚠ ${recommendError.value}`
          : `⚠ ${recommendError.value}`;
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(t("common.stageAborted"));
          assistantMessage.stagesDone = true;
        }
      },
    });
  }

  // 질문 카드 응답 반영(v3) — operation="fill_cards" 결정론 턴. 값 대입은 백엔드
  // 에이전트가 카드 targets 좌표로 수행하고, 결과는 새 추천 버전으로 저장된다.
  const FILL_CARDS_MESSAGE = "질문 카드 응답을 흐름도에 반영해줘";
  const fillCardsStatus = ref("idle"); // idle | sending | error

  async function fillCards(cardValues) {
    if (!sessionId.value || !cardValues || !Object.keys(cardValues).length) return;
    if (fillCardsStatus.value === "sending" || useChatStore().isSending) return;
    fillCardsStatus.value = "sending";

    const assistantMessage = pushChatTurn(FILL_CARDS_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);
    const signal = startTurnController();
    await useSettingsStore().loadAgentVersions();

    await turnStream(sessionId.value, FILL_CARDS_MESSAGE, {
      operation: "fill_cards",
      cardValues,
      agentVersion: useSettingsStore().agentVersion,
      signal,
      onStage: (message) => {
        if (signal.aborted) return;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onPartial: (data) => {
        if (signal.aborted) return;
        applyLiveFrame(data);
      },
      onToken: (token) => {
        if (signal.aborted) return;
        typewriter.push(token);
      },
      onDone: (data) => {
        if (signal.aborted) return;
        applyTurnArtifacts(data); // recommendation이 오면 새 버전 반영 (기존 계약 그대로)
        resetLiveFlow();
        // recommendation 없이 종료되면 반영 실패 — 성공 문구 대신 실패 문구로 마무리한다
        // (startAnalysis/startRecommend의 분기 동작과 일관).
        const ok = !!data?.recommendation;
        fillCardsStatus.value = ok ? "idle" : "error";
        if (typewriter.started) typewriter.finish();
        else typewriter.push(data?.answer || (ok ? "질문 카드 응답을 반영했어요." : "카드 반영에 실패했어요."));
        if (assistantMessage.stages.length) assistantMessage.stagesDone = true;
      },
      onError: (code, message) => {
        if (signal.aborted) return;
        typewriter.finish();
        resetLiveFlow();
        fillCardsStatus.value = "error";
        assistantMessage.text = assistantMessage.text
          ? `${assistantMessage.text}\n\n⚠ ${message || "카드 반영에 실패했어요."}`
          : `⚠ ${message || "카드 반영에 실패했어요."}`;
      },
    });
  }

  async function loadRecommendationHistory() {
    if (!sessionId.value) return;
    try {
      const { versions } = await listRecommendations(sessionId.value);
      recommendVersions.value = versions;
    } catch {
      // 버전 이력 조회 실패는 핵심 기능이 아니므로 조용히 무시
    }
  }

  async function persistRecommendationTree(tree, changeSummary, source) {
    const mySessionId = sessionId.value;
    const myRecommendGeneration = recommendGeneration;
    try {
      const saved = await saveRecommendation(mySessionId, {
        recommendation: tree,
        parentVersion: recommendation.value?.version,
        source,
        changeSummary,
      });
      // 저장을 기다리는 동안 다른 세션으로 이동했거나(sessionId 변경) 같은 세션에서
      // startAnalysis()가 추천 상태를 다시 초기화했으면(recommendGeneration 변경) 이 응답은
      // 낡은 것이다 — 지금 상태를 덮어쓰지 않는다.
      if (sessionId.value !== mySessionId || recommendGeneration !== myRecommendGeneration) return;
      recommendation.value = { ...saved, recommendation: tree };
      recommendTreesByVersion.value[saved.version] = JSON.parse(JSON.stringify(tree));
      recommendSaveError.value = "";
      loadRecommendationHistory();
    } catch (err) {
      if (sessionId.value !== mySessionId || recommendGeneration !== myRecommendGeneration) return;
      // recommendStatus는 그대로 "done"으로 둔다 — 여기서 "error"로 바꾸면 이미 만들어진
      // 흐름도 보기/실행 취소 화면이 사라지고 "다시 시도"가 전체 재생성 버튼으로 바뀐다.
      // 대신 recommendSaveError로만 실패를 알린다(과거엔 이 필드가 없어 실패가 조용히 묻혔다).
      recommendSaveError.value =
        err instanceof ApiError ? err.message : t("pipeline.errors.saveGeneric");
    }
  }

  // 완성된 Recommendation 트리를 새 버전으로 저장한다(수정=UPDATE 아님). 호출마다 무조건
  // 새 버전이 쌓이므로 미세 조작마다 부르면 버전이 폭발한다 — 사용자 편집은 아래
  // applyAnalysisEditsToFlow의 명시 "저장" 버튼 1회 = 1버전으로만 태운다.
  async function saveRecommendationEdit(newTree, changeSummary) {
    if (!sessionId.value || !recommendation.value) return;
    // 저장이 실패할 수 있으니 성공했을 때만 실행취소 스택에 쌓는다 — 미리 쌓으면 실패한
    // (아무 변화도 없었던) 시도가 되돌릴 대상 없는 스냅샷을 남겨 실행취소 이력을 어긋나게 한다.
    const previousTree = JSON.parse(JSON.stringify(recommendation.value.recommendation));
    await persistRecommendationTree(newTree, changeSummary ?? null, "drag");
    if (!recommendSaveError.value) recommendUndoStack.value.push(previousTree);
  }

  // ----- 업무 단계 편집 → 흐름도 반영 (명시 저장 버튼) -----
  // 업로드 패널의 단계 카드 편집(드래그/수정/삭제/추가)은 analysis.steps(WorkStep[])를
  // 메모리에서만 고친다. 이 스키마는 저장 API가 받는 Recommendation 트리(steps[].actions[])와
  // 달라 그대로 보내면 400 INVALID_RECOMMENDATION — 저장 시 분석 steps의 순서·구성을 추천
  // 트리 steps에 step_id 기준으로 투영한다: 재정렬·삭제·삽입은 따라가고, 각 step의 actions
  // 서브트리는 보존하며, 새로 추가된 step(추천 트리에 대응 없음)은 actions: []로 들어간다.
  const analysisEditSummaries = ref([]); // 이번 저장에 묶일 편집 종류 모음 → change_summary
  const analysisEditsDirty = computed(() => analysisEditSummaries.value.length > 0);
  const isSavingAnalysisEdits = ref(false);

  function markAnalysisEdited(summary) {
    if (summary && !analysisEditSummaries.value.includes(summary)) {
      analysisEditSummaries.value.push(summary);
    }
  }

  async function applyAnalysisEditsToFlow() {
    if (!sessionId.value || !recommendation.value || !analysis.value) return;
    if (!analysisEditsDirty.value || isSavingAnalysisEdits.value) return;
    isSavingAnalysisEdits.value = true;
    const base = JSON.parse(JSON.stringify(recommendation.value.recommendation));
    const recStepById = new Map((base.steps ?? []).map((s) => [s.step_id, s]));
    base.steps = (analysis.value.steps ?? []).map(
      (s) => recStepById.get(s.step_id) ?? { step_id: s.step_id, actions: [] },
    );
    await saveRecommendationEdit(base, analysisEditSummaries.value.join(", ").slice(0, 500) || null);
    // 실패 시 recommendSaveError가 남고 편집 표시(dirty)도 유지된다 — 사용자가 다시 저장 가능
    if (!recommendSaveError.value) analysisEditSummaries.value = [];
    isSavingAnalysisEdits.value = false;
  }

  // 직전 트리 스냅샷을 다시 저장해서 "취소"한다 — 백엔드엔 삭제가 없고 항상 새 버전만 쌓인다.
  async function undoRecommendationEdit() {
    if (!sessionId.value || recommendUndoStack.value.length === 0) return;
    // 저장이 실패할 수 있으니 성공했을 때만 pop한다 — 미리 pop하면 실패 시 스냅샷을 잃는다.
    const previous = recommendUndoStack.value[recommendUndoStack.value.length - 1];
    await persistRecommendationTree(previous, t("pipeline.changeSummaryUndo"), "drag");
    if (!recommendSaveError.value) recommendUndoStack.value.pop();
  }

  // 버전 이력 UI의 "이 버전으로 되돌리기" — 백엔드는 append-only이고 개별 버전 조회 API가 없어,
  // 이 브라우저 세션에서 캐시해 둔 해당 버전 트리를 새 버전으로 다시 저장한다. 캐시에 없는
  // 버전(예: 페이지 새로고침 이전에 만든 버전)은 모달이 되돌리기 버튼 자체를 숨긴다.
  async function revertToRecommendationVersion(version) {
    const tree = recommendTreesByVersion.value[version];
    if (!tree || recommendation.value?.version === version) return;
    await saveRecommendationEdit(JSON.parse(JSON.stringify(tree)), t("pipeline.changeSummaryRevert", { version }));
  }

  function resetUpload() {
    clearTimers();
    cancelActiveTurn();
    cancelActiveUpload();
    nextUploadGeneration();
    // 세션 로딩(loadSession)이 아직 진행 중일 때 "새 채팅"을 누르는 경우도 세대를 올려야
    // 한다 — sessionId만 null로 비우면, 이미 날아간 요청의 세대가 여전히 최신으로 보여
    // 늦게 도착한 응답이 방금 비운 화면을 옛 세션 데이터로 다시 채워버린다.
    nextSessionGeneration();
    sessionLoadStatus.value = "idle";
    file.value = null;
    uploadStatus.value = "idle";
    uploadError.value = "";
    sessionId.value = null;
    usageGauge.value = null; // 게이지는 세션 누적치라 세션이 사라질 때만 리셋한다
    resetPipelineState();
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

  // 사이드바 세션 이력에서 과거 세션을 선택했을 때, 그 세션을 "현재 세션"으로 하이드레이션한다.
  // 목록 API가 원본 업로드 파일명을 돌려주지 않으므로 업로드 패널은 빈 드롭존으로 시작하되,
  // 같은 sessionId로 새 문서를 이어 올리거나(selectFile) 채팅을 계속할 수 있다.
  async function loadSession(id) {
    if (!id || sessionId.value === id) return;
    clearTimers();
    cancelActiveTurn();
    cancelActiveUpload();
    nextUploadGeneration();
    const myGeneration = nextSessionGeneration();
    sessionId.value = id;
    file.value = null;
    document.value = null;
    uploadStatus.value = "idle";
    uploadError.value = "";
    usageGauge.value = null;
    resetPipelineState();
    sessionLoadStatus.value = "loading";

    let analysisRes, recommendationRes;
    try {
      [analysisRes, recommendationRes] = await Promise.all([
        swallowNotFound(getLatestAnalysis(id)),
        swallowNotFound(getLatestRecommendation(id)),
        useChatStore().loadHistoryMessages(id, myGeneration),
      ]);
    } catch (err) {
      // 응답이 오기 전에 다른 세션으로 이동했거나(A→B) 같은 세션을 다시 불러왔으면(A→B→A)
      // 이 시도는 낡은 것이다 — sessionId 비교만으론 후자를 구분 못 해 세대로 확인한다.
      // 이 가드 덕분에, 로딩 중 다른 세션을 클릭해 이미 다음 시도가 시작된 경우 낡은 시도의
      // 실패가 방금 시작된 새 로딩 상태(sessionLoadStatus="loading")를 덮어쓰지 않는다.
      if (myGeneration !== sessionGeneration.value) return;
      sessionLoadStatus.value = "error";
      uploadStatus.value = "error";
      uploadError.value = err instanceof ApiError ? err.message : t("pipeline.errors.sessionLoadFailed");
      return;
    }
    // 응답이 오기 전에 세션이 바뀌었거나 같은 세션을 다시 불러왔으면 버린다
    if (myGeneration !== sessionGeneration.value) return;

    if (analysisRes) {
      analysis.value = { ...analysisRes.result, analysis_id: analysisRes.analysis_id ?? null };
      analysisStatus.value = "done";
    }
    if (recommendationRes) {
      recommendation.value = recommendationRes;
      recommendStatus.value = "done";
      recommendTreesByVersion.value[recommendationRes.version] = JSON.parse(
        JSON.stringify(recommendationRes.recommendation),
      );
    }
    sessionLoadStatus.value = "idle";
    loadRecommendationHistory();
  }

  return {
    file,
    uploadStatus,
    uploadError,
    sessionId,
    sessionGeneration,
    document,
    analysisStatus,
    analysisStage,
    analysisError,
    analysis,
    recommendStatus,
    recommendStage,
    recommendError,
    recommendation,
    recommendVersions,
    recommendUndoStack,
    recommendTreesByVersion,
    recommendSaveError,
    usageGauge,
    sessionLoadStatus,
    liveFlow,
    liveViolations,
    liveCaption,
    liveActive,
    liveActiveStep,
    liveAnalysis,
    liveSpec,
    liveCandidates,
    liveVerdict,
    liveScorecard,
    fillCardsStatus,
    applyLiveFrame,
    resetLiveFlow,
    selectFile,
    submitTextRequest,
    applyTurnArtifacts,
    startAnalysis,
    startRecommend,
    fillCards,
    startTurnController,
    loadSession,
    loadRecommendationHistory,
    saveRecommendationEdit,
    undoRecommendationEdit,
    revertToRecommendationVersion,
    analysisEditsDirty,
    isSavingAnalysisEdits,
    markAnalysisEdited,
    applyAnalysisEditsToFlow,
    resetUpload,
  };
});
