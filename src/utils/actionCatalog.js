// 흐름도 편집기 좌측 "패키지/액션" 피커가 쓰는 카탈로그 로더. GET /api/catalog/packages(RPA-313,
// 인증 불필요)를 소비 측(ActionCatalogPanel/ActionCatalogList/FlowCanvas)이 기대하는 형태
// ({id,name,actions:[{id,action,label,isContainer}]})로 매핑한다.
import { apiRequest } from "../api/http";
import { t } from "../i18n";

// 카탈로그는 57패키지·368액션 규모의 정적 참조 데이터라 세션 중 안 바뀐다 — 피커를 여러 번 열어도
// (사이드바 재마운트, 액션 교체 팝오버 재오픈) 최초 1회만 fetch하고 이후엔 같은 프라미스를
// 공유한다. 실패하면 캐시를 비워 다음 호출(재시도)에서 다시 fetch하게 한다.
let catalogPromise = null;
// 카탈로그가 로드되고 나면 "package.action" → isContainer 여부를 동기적으로 확인할 수 있게
// 채워진다(flowTree.stripEmptyChildren이 백엔드가 항상 내려주는 빈 children:[]을 걷어낼 때,
// 리프 액션인지 진짜 빈 컨테이너인지 구분하는 유일한 근거 — Qodo 리뷰, actionCatalog.js 참고).
let containerActionKeys = null;

// package/action은 카탈로그 machine명(예: Excel_MS/GoToCell)이다 — 표시명(label)이 아니다.
// id/actions[].action에 이 machine명을 그대로 남겨야 toActionDescriptor → node.package/node.action
// 경로에서 표시명이 섞이지 않고, 저장 후 재채점 시 "카탈로그에 없는 액션"으로 오판되지 않는다.
function mapCatalogResponse(data) {
  return (data?.packages ?? []).map((pkg) => ({
    id: pkg.package,
    name: pkg.label,
    actions: (pkg.actions ?? []).map((entry) => ({
      id: `${pkg.package}.${entry.action}`,
      action: entry.action,
      label: entry.label,
      isContainer: !!entry.isContainer,
    })),
  }));
}

export function loadActionCatalog() {
  if (!catalogPromise) {
    catalogPromise = apiRequest("/api/catalog/packages")
      .then(mapCatalogResponse)
      .then((packages) => {
        containerActionKeys = new Set();
        for (const pkg of packages) {
          for (const entry of pkg.actions) {
            if (entry.isContainer) containerActionKeys.add(`${pkg.id}.${entry.action}`);
          }
        }
        return packages;
      })
      .catch((err) => {
        catalogPromise = null;
        containerActionKeys = null;
        throw err;
      });
  }
  return catalogPromise;
}

// loadActionCatalog()가 이미 끝났다는 전제하에(FlowWindowApp 부팅 시퀀스에서 미리 기다린다)
// 동기적으로 컨테이너 여부를 확인한다. 아직 로드 전이거나 실패했으면 false를 반환하는데,
// stripEmptyChildren 입장에선 "컨테이너로 확인 안 됨" = 예전처럼 지우는 쪽(폴백)으로 이어진다 —
// 카탈로그가 없을 때 모든 리프가 컨테이너 프레임으로 보이는 쪽보다는, 드물게나마 빈 컨테이너가
// 리프로 오인되는 예전 동작이 덜 눈에 띈다.
export function isKnownContainerAction(packageName, action) {
  return !!containerActionKeys?.has(`${packageName}.${action}`);
}

// 네이티브 HTML5 DnD로 피커 → 캔버스에 페이로드를 실어 나를 때 쓰는 dataTransfer MIME 타입.
// 이 값으로 "우리 액션 카드를 드래그 중"인지(파일 드래그 등 다른 드래그와 구분)를 식별한다.
export const ACTION_CATALOG_MIME = "application/x-a360-action";

// 카탈로그 그룹(pkg)+항목(entry)을 드래그 페이로드/클릭 삽입이 공유하는 직렬화 가능한 서술자로 변환.
// packageName엔 pkg.id(machine명)를 담는다 — pkg.name은 화면 표시용 label이라 여기 쓰면
// node.package가 카탈로그 machine명과 어긋난다.
export function toActionDescriptor(pkg, entry) {
  return { packageName: pkg.id, action: entry.action, label: entry.label, isContainer: !!entry.isContainer };
}

// 서술자로 편집 트리에 끼워 넣을 새 RecommendedAction 노드를 만든다. __uid는 일부러 안 붙인다 —
// 삽입 직후 flowTree.assignUiIds가 트리 전체를 훑으며(이미 있는 노드는 건드리지 않고) 채운다.
// confidence는 AI가 산출하는 수치라 사용자가 직접 넣거나 고친 액션엔 애초에 값이 없다(null) —
// 그 자체는 정상이지만, JSON 내보내기 등 원본 데이터를 그대로 내려주는 경로에서는 "왜 신뢰도가
// 없는지"가 안 드러나 AI가 값을 못 낸 경우와 구분이 안 됐다. confidence는 백엔드 스키마가
// float|None으로만 받아 문자열을 못 넣으므로, 이미 자유 텍스트인 rationale에 안내 문구를
// 남겨 둔다 — JSON·DOCX·Markdown·상세 패널 어디서 봐도 이 액션이 사용자 편집분임을 알 수 있다.
export function createActionNode(descriptor) {
  const node = {
    package: descriptor.packageName,
    action: descriptor.action,
    label: descriptor.label,
    parameters: [],
    confidence: null,
    rationale: t("recommendFlow.userEditedRationale"),
    sources: [],
  };
  if (descriptor.isContainer) node.children = [];
  return node;
}
