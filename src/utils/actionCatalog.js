// 흐름도 편집기 좌측 "패키지/액션" 피커가 쓰는 목업 카탈로그. 백엔드에 아직 패키지/액션
// 목록 API가 없어 정적 데이터로 대체한다 — 나중에 API 연동 시 이 배열을 fetch 결과로
// 바꿔치기하면 되도록, 소비 측(ActionCatalogPanel/FlowCanvas)은 이 파일의 형태({id,name,
// actions:[{id,action,label,isContainer}]})에만 의존하고 데이터 출처는 모른다.
export const ACTION_CATALOG = [
  {
    id: "excel",
    name: "Excel",
    actions: [
      { id: "excel.openWorkbook", action: "openWorkbook", label: "통합 문서 열기" },
      { id: "excel.readRange", action: "readRange", label: "범위 읽기" },
      { id: "excel.writeCell", action: "writeCell", label: "셀에 쓰기" },
      { id: "excel.saveWorkbook", action: "saveWorkbook", label: "통합 문서 저장" },
    ],
  },
  {
    id: "webAutomation",
    name: "Web Automation",
    actions: [
      { id: "web.openBrowser", action: "openBrowser", label: "브라우저 열기" },
      { id: "web.navigate", action: "navigate", label: "URL 이동" },
      { id: "web.click", action: "click", label: "클릭" },
      { id: "web.extractText", action: "extractText", label: "텍스트 추출" },
    ],
  },
  {
    id: "mail",
    name: "Mail",
    actions: [
      { id: "mail.sendMail", action: "sendMail", label: "메일 보내기" },
      { id: "mail.readInbox", action: "readInbox", label: "받은 편지함 읽기" },
    ],
  },
  {
    id: "fileSystem",
    name: "File System",
    actions: [
      { id: "file.copy", action: "copy", label: "파일 복사" },
      { id: "file.move", action: "move", label: "파일 이동" },
      { id: "file.delete", action: "delete", label: "파일 삭제" },
    ],
  },
  {
    id: "controlFlow",
    name: "Control Flow",
    actions: [
      { id: "controlFlow.loop", action: "loop", label: "반복", isContainer: true },
      { id: "controlFlow.step", action: "step", label: "하위 단계", isContainer: true },
      { id: "controlFlow.wait", action: "wait", label: "대기" },
    ],
  },
];

// 네이티브 HTML5 DnD로 피커 → 캔버스에 페이로드를 실어 나를 때 쓰는 dataTransfer MIME 타입.
// 이 값으로 "우리 액션 카드를 드래그 중"인지(파일 드래그 등 다른 드래그와 구분)를 식별한다.
export const ACTION_CATALOG_MIME = "application/x-a360-action";

// 카탈로그 그룹(pkg)+항목(entry)을 드래그 페이로드/클릭 삽입이 공유하는 직렬화 가능한 서술자로 변환.
export function toActionDescriptor(pkg, entry) {
  return { packageName: pkg.name, action: entry.action, label: entry.label, isContainer: !!entry.isContainer };
}

// 서술자로 편집 트리에 끼워 넣을 새 RecommendedAction 노드를 만든다. __uid는 일부러 안 붙인다 —
// 삽입 직후 flowTree.assignUiIds가 트리 전체를 훑으며(이미 있는 노드는 건드리지 않고) 채운다.
export function createActionNode(descriptor) {
  const node = {
    package: descriptor.packageName,
    action: descriptor.action,
    label: descriptor.label,
    parameters: [],
    confidence: null,
    rationale: null,
    sources: [],
  };
  if (descriptor.isContainer) node.children = [];
  return node;
}
