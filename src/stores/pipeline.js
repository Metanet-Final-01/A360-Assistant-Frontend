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

    try {
      const doc = await uploadDocument(inputFile, sessionId.value);
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
        onDone: (data) => {
          document.value = data;
          uploadStatus.value = "uploaded";
        },
        onError: (message) => {
          uploadStatus.value = "error";
          uploadError.value = message;
        },
      });
    } catch (err) {
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

    clearTimers();
    uploadError.value = "";
    file.value = { name: "텍스트 입력", size: trimmed.length, ext: "txt" };
    uploadStatus.value = "uploading";
    resetPipelineState();

    try {
      const doc = await createDocumentFromText(trimmed, sessionId.value);
      sessionId.value = doc.session_id;
      document.value = doc;
      uploadStatus.value = doc.status === "failed" ? "error" : "uploaded";
      if (doc.status === "failed") {
        uploadError.value = doc.error || "요청을 처리하지 못했습니다.";
      }
    } catch (err) {
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

    await turnStream(sessionId.value, ANALYZE_MESSAGE, {
      onStage: (message) => {
        analysisStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onToken: (token) => {
        typewriter.push(token);
      },
      onDone: (data) => {
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
    recommendStatus.value = "generating";
    recommendStage.value = "";
    recommendError.value = "";
    recommendSaveError.value = "";

    const assistantMessage = pushChatTurn(RECOMMEND_MESSAGE);
    const typewriter = createTypewriter(assistantMessage);

    await turnStream(sessionId.value, RECOMMEND_MESSAGE, {
      onStage: (message) => {
        recommendStage.value = message;
        if (message?.trim()) assistantMessage.stages.push(message.trim());
      },
      onToken: (token) => {
        typewriter.push(token);
      },
      onDone: (data) => {
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
        useChatStore().loadHistoryMessages(id),
      ]);
    } catch (err) {
      // 응답이 오기 전에 다른 세션으로 이동했으면 에러도 버린다
      if (sessionId.value !== id) return;
      uploadStatus.value = "error";
      uploadError.value = err instanceof ApiError ? err.message : "세션을 불러오지 못했습니다.";
      return;
    }
    // 응답이 오기 전에 다른 세션으로 이동했으면 버린다
    if (sessionId.value !== id) return;

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
    loadSession,
    loadRecommendationHistory,
    saveRecommendationEdit,
    undoRecommendationEdit,
    revertToRecommendationVersion,
    resetUpload,
  };
});
