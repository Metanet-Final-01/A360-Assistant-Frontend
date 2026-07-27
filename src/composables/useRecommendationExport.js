import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport } from "../api/recommend";
import { triggerBlobDownload } from "../utils/download";

// 흐름도 내보내기(JSON/Markdown/DOCX) — 상단 헤더의 "내보내기"와 하단 액션 바의
// "JSON 다운로드"가 같은 동작을 제공하므로 로직을 한 곳에 모은다.
//
// utils/exportFlow는 docx 라이브러리를 끌고 와 무겁다. 이 컴포저블은 상단 헤더(메인 청크에
// 정적 임포트)에서도 쓰이므로, 정적 임포트로 두면 로그인 화면 첫 로딩에 그 비용이 얹힌다 —
// 실제로 누를 때 동적 임포트해서 메인 청크 밖에 남긴다.
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
      const { recommendationToDocxBlob } = await import("../utils/exportFlow");
      const blob = await recommendationToDocxBlob(pipeline.recommendation.recommendation, {
        documentTitle: pipeline.analysis?.document_title,
      });
      triggerBlobDownload(blob, `${filenameBase.value}.docx`);
    } catch {
      exportError.value = t("recommendDetail.errors.exportFailed");
    }
  }

  return { canExport, exportError, downloadJson, downloadMarkdown, downloadDocx };
}
