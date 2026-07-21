// Blob을 파일로 저장하는 공용 헬퍼 — JSON 내보내기(recommend.js)와 신규 Markdown/DOCX/이미지
// 내보내기가 모두 같은 앵커 클릭 방식을 쓴다.
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
