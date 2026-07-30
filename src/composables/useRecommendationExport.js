import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport, downloadRecommendationDocx } from "../api/recommend";
import { triggerBlobDownload } from "../utils/download";

// 흐름도 내보내기(JSON/Markdown/DOCX) — AnalysisPanel 헤더의 "내보내기" 드롭다운이 쓴다.
//
// DOCX는 백엔드가 서식 있는 문서로 만들어 준다(RPA-296/RPA-329). 흐름도 이미지를 실을지는
// 호출부 재량이다 — AnalysisPanel은 화면 밖에 숨겨 둔 FlowCanvas로 페이지를 캡처해
// flowImageBlobs로 넘기고(자세한 캡처 절차는 AnalysisPanel.vue 참고), 캡처가 없거나 실패해도
// downloadDocx(undefined)로 이미지 없이 호출하면 개요·요구사항·변수·질문카드 등 나머지 내용은
// 그대로 담긴 문서가 나온다. utils/exportFlow(Markdown 조립)는 무거우므로 실제로 누를 때만
// 동적 임포트해서 메인 청크 밖에 남긴다.
export function useRecommendationExport() {
  const pipeline = usePipelineStore();
  const { t } = useI18n();

  const exportError = ref("");
  const canExport = computed(() => !!pipeline.sessionId && pipeline.recommendation?.version != null);

  const filenameBase = computed(() => {
    const version = pipeline.recommendation?.version;
    return `recommendation-${pipeline.sessionId}${version != null ? `-v${version}` : ""}`;
  });

  // JSON은 백엔드 표준 export API 응답을 그대로 저장한다(P1-3 — schema_version 포함 봉투,
  // 골든셋 채점 포맷과 일치). 프론트에서 조립하면 그 포맷이 어긋난다.
  async function downloadJson() {
    if (!canExport.value) return;
    exportError.value = "";
    try {
      await downloadRecommendationExport(pipeline.sessionId, pipeline.recommendation.version);
    } catch (err) {
      exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
    }
  }

  async function downloadMarkdown() {
    if (!canExport.value) return;
    exportError.value = "";
    try {
      const { recommendationToMarkdown } = await import("../utils/exportFlow");
      const md = recommendationToMarkdown(pipeline.recommendation.recommendation, {
        documentTitle: pipeline.analysis?.document_title,
      });
      triggerBlobDownload(
        new Blob([md], { type: "text/markdown;charset=utf-8" }),
        `${filenameBase.value}.md`,
      );
    } catch {
      exportError.value = t("recommendDetail.errors.exportFailed");
    }
  }

  // flowImageBlobs: 호출부(AnalysisPanel)가 흐름도 캔버스를 페이지 단위로 캡처해 준 PNG blob
  // 배열(순서대로) — 넘기지 않으면 이미지 없이 문서만 내려받는다(백엔드가 그대로 지원).
  async function downloadDocx(flowImageBlobs) {
    if (!canExport.value) return;
    exportError.value = "";
    try {
      await downloadRecommendationDocx(pipeline.sessionId, pipeline.recommendation.version, flowImageBlobs);
    } catch (err) {
      exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
    }
  }

  return { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx };
}
