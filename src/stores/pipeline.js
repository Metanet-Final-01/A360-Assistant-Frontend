import { defineStore } from "pinia";
import { ref } from "vue";
import { uploadDocument, parseDocument, createDocumentFromText } from "../api/documents";
import { analyzeSession } from "../api/analysis";
import { recommendSession, listRecommendations, saveRecommendation } from "../api/recommend";
import { ApiError } from "../api/http";

// NOTE: 분석(/api/sessions/{id}/analyze)·추천/흐름도(/api/sessions/{id}/recommend 등, RPA-61)는
// 전부 실제 백엔드와 연동되어 있다. recommendation.recommendation이 흐름도 트리(steps→actions→children)
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

  // 분석 상태 (POST /api/sessions/{id}/analyze)
  const analysisStatus = ref("idle"); // idle | analyzing | done | error
  const analysisStage = ref(""); // 진행 중 stage 이벤트의 표시용 문구
  const analysisError = ref("");
  const analysis = ref(null); // done.data 원본: { analysis_id, document_title, summary, steps, ambiguities }

  // 흐름도(추천안) 상태 (POST /api/sessions/{id}/recommend 등, RPA-61)
  const recommendStatus = ref("idle"); // idle | generating | done | error
  const recommendStage = ref("");
  const recommendError = ref("");
  const recommendation = ref(null); // { id, version, parent_version, source, change_summary, created_at, recommendation: {schema_version, steps, variables, notes} }
  const recommendVersions = ref([]); // GET .../recommendations 메타 목록 (최신 순, 트리 내용은 없음)
  const recommendUndoStack = ref([]); // 편집 직전 트리 스냅샷들 — 실행취소 시 pop해서 다시 저장
  const recommendTreesByVersion = ref({}); // 이 세션에서 확보한 버전별 트리 캐시 — 버전 이력 "되돌리기"의 원본 (백엔드엔 개별 버전 조회 API가 없다)
  const recommendSaveError = ref(""); // 편집/실행취소 저장 실패 시 메시지 — done 화면은 유지한 채 이 메시지만 보여준다

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

    await analyzeSession(sessionId.value, {
      onStage: (message) => {
        analysisStage.value = message;
      },
      onDone: (data) => {
        analysis.value = data;
        analysisStatus.value = "done";
      },
      onError: (code, message) => {
        // 503 AGENT_UNAVAILABLE은 엔진 랜딩 전의 레거시 케이스라 방어적으로만 남겨둔다 — 재시도 안내로 충분
        analysisStatus.value = "error";
        analysisError.value =
          code === "AGENT_UNAVAILABLE"
            ? "분석 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
            : message || "분석 중 오류가 발생했습니다.";
      },
    });
  }

  // 흐름도(추천안) 생성 — 최신 분석 결과 기준으로 A360 액션 트리를 만들어 v1로 저장한다 (RPA-61)
  async function startRecommend() {
    if (analysisStatus.value !== "done" || !sessionId.value || recommendStatus.value === "generating") {
      return;
    }
    recommendStatus.value = "generating";
    recommendStage.value = "";
    recommendError.value = "";
    recommendSaveError.value = "";

    await recommendSession(sessionId.value, {
      onStage: (message) => {
        recommendStage.value = message;
      },
      onDone: (data) => {
        recommendation.value = data;
        recommendStatus.value = "done";
        recommendUndoStack.value = [];
        recommendTreesByVersion.value = {
          [data.version]: JSON.parse(JSON.stringify(data.recommendation)),
        };
        loadRecommendationHistory();
      },
      onError: (code, message) => {
        recommendStatus.value = "error";
        recommendError.value =
          code === "AGENT_UNAVAILABLE"
            ? "추천 엔진이 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요."
            : message || "추천안 생성 중 오류가 발생했습니다.";
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
    resetPipelineState();
  }

  function buildExportPayload() {
    return {
      document: file.value?.name ?? null,
      generatedAt: new Date().toISOString(),
      analysis: analysis.value,
      recommendation: recommendation.value?.recommendation ?? null,
    };
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
    selectFile,
    submitTextRequest,
    startAnalysis,
    startRecommend,
    loadRecommendationHistory,
    saveRecommendationEdit,
    undoRecommendationEdit,
    revertToRecommendationVersion,
    resetUpload,
    buildExportPayload,
  };
});
