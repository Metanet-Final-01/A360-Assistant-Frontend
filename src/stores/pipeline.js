import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { uploadDocument, parseDocument, createDocumentFromText } from "../api/documents";
import { turnStream } from "../api/agent";
import { listRecommendations, saveRecommendation, getLatestRecommendation } from "../api/recommend";
import { getLatestAnalysis } from "../api/sessions";
import { ApiError } from "../api/http";
import { useChatStore } from "./chat";
import { useArchiveStore } from "./archive";
import { nowTime } from "../utils/chatMessages";
import { createTypewriter } from "../utils/typewriter";

// NOTE: 분석·추천 생성은 에이전트 단일 진입점 POST /api/sessions/{id}/turn으로 통합됐다
// (RPA-64/67 — 레거시 /analyze·/recommend는 제거). 버튼은 합성 메시지를 보내고, done.data의
// 산출물 필드(analysis_result/recommendation)를 보고 상태를 갱신한다(applyTurnArtifacts —
// 챗에서 만들어진 분석/흐름도도 같은 경로로 반영된다).
// recommendation.recommendation이 흐름도 트리(steps→actions→children)
// 원본이고, RecommendationFlowModal이 이를 렌더·편집한다 — 편집은 모달의 로컬 복사본에서만 하고
// "저장" 버튼을 눌렀을 때 한 번만 새 버전으로 저장한다(POST .../recommendations, 호출마다 무조건
// 새 버전 INSERT). 백엔드에 개별 버전 조회 API가 없어 실행취소·버전 되돌리기는 프론트가 들고 있는
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
  }

  async function selectFile(inputFile) {
    // 챗 턴이 진행 중이면 여기서 cancelActiveTurn()으로 그 스트림을 끊지 않는다 — 끊긴 챗
    // 턴은 onDone/onError 없이 끝나 말풍선이 "응답 중" 상태로 영영 멈춰버린다(RPA-107).
    // 챗이 끝난 뒤 다시 시도하게 한다 — UI도 이 조건일 때 업로드를 막아야 한다(최종 방어선).
    if (useChatStore().isSending) return;
    const ext = inputFile.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      uploadStatus.value = "error";
      uploadError.value = "PDF · PPT · PPTX · DOCX 파일만\n업로드할 수 있습니다.";
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
        uploadError.value = doc.error || "문서 파싱에 실패했습니다.";
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
        err instanceof ApiError ? err.message : "업로드 중 알 수 없는 오류가 발생했습니다.";
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
    file.value = { name: "텍스트 입력", size: trimmed.length, ext: "txt" };
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
        uploadError.value = doc.error || "요청을 처리하지 못했습니다.";
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // 새 업로드/초기화로 의도적으로 취소됨
      if (myGeneration !== uploadGeneration) return;
      uploadStatus.value = "error";
      uploadError.value =
        err instanceof ApiError ? err.message : "요청 처리 중 알 수 없는 오류가 발생했습니다.";
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
  const ANALYZE_MESSAGE = "이 업무정의서를 분석해서 자동화 흐름도까지 만들어줘";
  // 추천안 생성 버튼 합성 메시지 (작업 명세의 문구 그대로)
  const RECOMMEND_MESSAGE = "이 업무정의서로 자동화 흐름도 만들어줘";

  // 분석/추천 버튼도 결국 /turn에 합성 메시지를 보내는 것뿐이라, 챗과 똑같이 사용자 턴으로
  // 챗봇 화면에 남긴다 — 버튼으로 시작했든 챗으로 시작했든 같은 세션 대화 흐름으로 보이게.
  function pushChatTurn(message) {
    const chat = useChatStore();
    chat.chatMessages.push({ role: "user", text: message, time: nowTime() });
    // stages: 이 턴 동안 받은 진행 상태 메시지 이력 — 말풍선 위 작은 텍스트를 누르면 펼쳐 보여준다.
    // stagesDone: 턴이 끝난 뒤에도 마지막 상태가 "완료" 문구로 남도록 표시한다.
    const assistantMessage = reactive({
      role: "assistant",
      text: "",
      stages: [],
      stagesOpen: false,
      stagesDone: false,
      time: nowTime(),
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

    const assistantMessage = pushChatTurn(ANALYZE_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);
    // signal.aborted를 콜백마다 확인한다 — cancelActiveTurn()이 fetch/reader를 끊어도, 이미
    // 버퍼에 도착해 있던 프레임(예: done)은 abort 이후에도 동기적으로 마저 처리될 수 있어
    // (스트림 구현체 타이밍 문제) 세션이 그대로여도 취소된 턴의 결과가 새로 지운 상태를
    // 다시 채울 수 있다 — 이 턴 소유권 검사가 최종 방어선이다.
    const signal = startTurnController();

    await turnStream(sessionId.value, ANALYZE_MESSAGE, {
      signal,
      onStage: (message) => {
        if (signal.aborted) return;
        analysisStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onToken: (token) => {
        if (signal.aborted) return;
        typewriter.push(token);
      },
      onDone: (data) => {
        if (signal.aborted) return;
        applyTurnArtifacts(data);
        if (!data?.analysis_result) {
          // 에이전트가 분석 대신 일반 답변으로 흐른 경우 — 성공 done이어도 분석 산출물이 없다
          analysisStatus.value = "error";
          analysisError.value = data?.answer || "분석 결과를 받지 못했습니다. 다시 시도해주세요.";
        }
        // 분석 노드는 token 스트림 없이 done에만 answer가 실린다 — 타자기 큐로 흘려보낸다.
        if (typewriter.started) {
          typewriter.finish();
        } else {
          typewriter.push(data?.answer || (data?.analysis_result ? "분석을 완료했습니다. 왼쪽 분석 결과 패널에서 확인해 주세요." : analysisError.value));
        }
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(data?.analysis_result ? "분석 완료" : "분석 실패");
          assistantMessage.stagesDone = true;
        }
      },
      onError: (code, message) => {
        if (signal.aborted) return;
        typewriter.finish();
        analysisStatus.value = "error";
        analysisError.value =
          code === "AGENT_UNAVAILABLE"
            ? "분석 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
            : message || "분석 중 오류가 발생했습니다.";
        assistantMessage.text = assistantMessage.text
          ? `${assistantMessage.text}\n\n⚠ ${analysisError.value}`
          : `⚠ ${analysisError.value}`;
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push("오류로 중단됨");
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

    const assistantMessage = pushChatTurn(RECOMMEND_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);
    // startAnalysis()와 동일한 이유(RPA-107) — 취소된 턴의 늦게 처리된 콜백이 방금 지운
    // 추천 상태를 다시 채우지 않도록 콜백마다 signal.aborted를 확인한다.
    const signal = startTurnController();

    await turnStream(sessionId.value, RECOMMEND_MESSAGE, {
      signal,
      onStage: (message) => {
        if (signal.aborted) return;
        recommendStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onToken: (token) => {
        if (signal.aborted) return;
        typewriter.push(token);
      },
      onDone: (data) => {
        if (signal.aborted) return;
        if (data?.recommendation) recommendUndoStack.value = []; // 새 생성 기준으로 실행취소 초기화
        applyTurnArtifacts(data);
        if (!data?.recommendation) {
          recommendStatus.value = "error";
          recommendError.value = data?.answer || "추천안을 받지 못했습니다. 다시 시도해주세요.";
        }
        // 추천 노드도 token 스트림 없이 done에만 answer가 실린다 — 타자기 큐로 흘려보낸다.
        if (typewriter.started) {
          typewriter.finish();
        } else {
          typewriter.push(data?.answer || (data?.recommendation ? "흐름도를 만들었습니다. '흐름도 보기'에서 확인해 주세요." : recommendError.value));
        }
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push(data?.recommendation ? "흐름도 생성 완료" : "흐름도 생성 실패");
          assistantMessage.stagesDone = true;
        }
      },
      onError: (code, message) => {
        if (signal.aborted) return;
        typewriter.finish();
        recommendStatus.value = "error";
        recommendError.value =
          code === "AGENT_UNAVAILABLE"
            ? "추천 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
            : message || "추천안 생성 중 오류가 발생했습니다.";
        assistantMessage.text = assistantMessage.text
          ? `${assistantMessage.text}\n\n⚠ ${recommendError.value}`
          : `⚠ ${recommendError.value}`;
        if (assistantMessage.stages.length) {
          assistantMessage.stages.push("오류로 중단됨");
          assistantMessage.stagesDone = true;
        }
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
    try {
      const saved = await saveRecommendation(sessionId.value, {
        recommendation: tree,
        parentVersion: recommendation.value?.version,
        source,
        changeSummary,
      });
      recommendation.value = { ...saved, recommendation: tree };
      recommendTreesByVersion.value[saved.version] = JSON.parse(JSON.stringify(tree));
      recommendSaveError.value = "";
      loadRecommendationHistory();
    } catch (err) {
      // recommendStatus는 그대로 "done"으로 둔다 — 여기서 "error"로 바꾸면 이미 만들어진
      // 흐름도 보기/실행 취소 화면이 사라지고 "다시 시도"가 전체 재생성 버튼으로 바뀐다.
      // 대신 recommendSaveError로만 실패를 알린다(과거엔 이 필드가 없어 실패가 조용히 묻혔다).
      recommendSaveError.value =
        err instanceof ApiError ? err.message : "추천안 저장 중 오류가 발생했습니다.";
    }
  }

  // 흐름도 모달(RecommendationFlowModal) 편집 모드에서 "저장" 버튼을 눌렀을 때 호출 —
  // 항상 새 버전으로 저장한다(수정=UPDATE 아님). 미세 조작마다 부르면 버전이 폭발하니 주의.
  async function saveRecommendationEdit(newTree, changeSummary) {
    if (!sessionId.value || !recommendation.value) return;
    recommendUndoStack.value.push(JSON.parse(JSON.stringify(recommendation.value.recommendation)));
    await persistRecommendationTree(newTree, changeSummary ?? null, "drag");
  }

  // 직전 트리 스냅샷을 다시 저장해서 "취소"한다 — 백엔드엔 삭제가 없고 항상 새 버전만 쌓인다.
  async function undoRecommendationEdit() {
    if (!sessionId.value || recommendUndoStack.value.length === 0) return;
    // 저장이 실패할 수 있으니 성공했을 때만 pop한다 — 미리 pop하면 실패 시 스냅샷을 잃는다.
    const previous = recommendUndoStack.value[recommendUndoStack.value.length - 1];
    await persistRecommendationTree(previous, "실행 취소", "drag");
    if (!recommendSaveError.value) recommendUndoStack.value.pop();
  }

  // 버전 이력 UI의 "이 버전으로 되돌리기" — 백엔드는 append-only이고 개별 버전 조회 API가 없어,
  // 이 브라우저 세션에서 캐시해 둔 해당 버전 트리를 새 버전으로 다시 저장한다. 캐시에 없는
  // 버전(예: 페이지 새로고침 이전에 만든 버전)은 모달이 되돌리기 버튼 자체를 숨긴다.
  async function revertToRecommendationVersion(version) {
    const tree = recommendTreesByVersion.value[version];
    if (!tree || recommendation.value?.version === version) return;
    await saveRecommendationEdit(JSON.parse(JSON.stringify(tree)), `v${version} 버전으로 되돌리기`);
  }

  function resetUpload() {
    clearTimers();
    cancelActiveTurn();
    cancelActiveUpload();
    nextUploadGeneration();
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
      if (myGeneration !== sessionGeneration.value) return;
      uploadStatus.value = "error";
      uploadError.value = err instanceof ApiError ? err.message : "세션을 불러오지 못했습니다.";
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
    selectFile,
    submitTextRequest,
    applyTurnArtifacts,
    startAnalysis,
    startRecommend,
    startTurnController,
    loadSession,
    loadRecommendationHistory,
    saveRecommendationEdit,
    undoRecommendationEdit,
    revertToRecommendationVersion,
    resetUpload,
  };
});
