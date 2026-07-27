import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport, downloadRecommendationDocx } from "../api/recommend";
import { triggerBlobDownload } from "../utils/download";

// 흐름도 내보내기(JSON/Markdown/DOCX) — 사이드바의 "내보내기"와 하단 액션 바의
// "JSON 다운로드"가 같은 동작을 제공하므로 로직을 한 곳에 모은다.
//
// DOCX는 백엔드가 서식 있는 문서로 만들어 준다(RPA-296/RPA-329) — 이 컴포저블 호출부(사이드바·
// 액션 바)엔 흐름도 캔버스가 없어 이미지 없이 호출하지만, 개요·요구사항·변수·질문카드 등
// 나머지 내용은 그대로 담긴 문서가 나온다(흐름도 이미지까지 포함하는 캡처는 flow-window의
// downloadFlowDocx 참고). utils/exportFlow(Markdown 조립)는 무거우므로 실제로 누를 때만
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

  async function downloadDocx() {
    if (!canExport.value) return;
    exportError.value = "";
    try {
      await downloadRecommendationDocx(pipeline.sessionId, pipeline.recommendation.version);
    } catch (err) {
      exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
    }
  }

  return { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx };
}
