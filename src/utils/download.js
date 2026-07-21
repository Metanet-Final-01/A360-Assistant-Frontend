// Blob을 파일로 저장하는 공용 헬퍼 — JSON 내보내기(recommend.js)와 신규 Markdown/DOCX/이미지
// 내보내기가 모두 같은 앵커 클릭 방식을 쓴다.
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // click() 직후 곧바로 revoke하면 일부 브라우저·큰 Blob에서 실제 다운로드가 URL을 채
  // 소비하기 전에 무효화될 수 있다 — 다음 틱으로 미뤄 다운로드가 시작될 시간을 준다.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
