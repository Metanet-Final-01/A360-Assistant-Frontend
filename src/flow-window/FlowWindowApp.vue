<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toBlob } from "html-to-image";
import { useAuthStore } from "../stores/auth";
import { usePipelineStore } from "../stores/pipeline";
import { useSettingsStore } from "../stores/settings";
import { downloadRecommendationDocx } from "../api/recommend";
import { formatDateShort } from "../utils/dateFormat";
import { triggerBlobDownload } from "../utils/download";
import FlowCanvas from "../components/flow-canvas/FlowCanvas.vue";
import ActionCatalogPanel from "../components/flow-canvas/ActionCatalogPanel.vue";
import { loadActionCatalog } from "../utils/actionCatalog";

// 추천 흐름도를 인앱 모달 대신 진짜 별도 브라우저 창(window.open)으로 띄운 페이지 — OS 창
// 컨트롤(최대화/최소화/이동/크기조절)을 그대로 쓸 수 있어, Fullscreen API가 강제로 띄우던
// "Esc로 전체화면 종료" 배너가 없다. 메인 창과는 별개의 JS 실행 컨텍스트(별도 Pinia)라
// sessionId만 받아 독립적으로 자기 상태를 REST로 하이드레이션한다 — main.js 부팅과 동일한
// 방식(AnalysisPanel.vue가 openFlowWindow()로 이 페이지를 연다).
const auth = useAuthStore();
const pipeline = usePipelineStore();
// App.vue와 동일한 이유로 여기서도 부른다 — 이 창의 <html>엔 아무도 data-theme을 안 찍어주므로
// useSettingsStore()를 생성하는 것 자체가 부팅 시 다크모드를 반영하는 유일한 계기다(스토어
// setup의 watch(theme, ..., {immediate:true})가 실행되게 하는 트리거일 뿐, 반환값은 안 쓴다).
useSettingsStore();
const { t } = useI18n();

const sessionId = new URLSearchParams(window.location.search).get("session");

const bootStatus = ref("loading"); // loading | unauthorized | not-found | error | ready

onMounted(async () => {
  await auth.bootstrapAuth();
  if (!auth.isLoggedIn) {
    bootStatus.value = "unauthorized";
    return;
  }
  if (!sessionId) {
    bootStatus.value = "not-found";
    return;
  }
  // loadActionCatalog()를 세션 로딩과 병렬로 미리 기다려 둔다 — FlowCanvas가 마운트되며
  // stripEmptyChildren으로 트리를 정규화할 때 카탈로그의 isContainer 정보가 이미 있어야
  // 빈 컨테이너 액션을 리프로 오인하지 않는다(Qodo 리뷰, flowTree.js/actionCatalog.js 참고).
  // 카탈로그 로딩 실패는 이 화면 전체를 막을 이유가 아니라 조용히 무시한다(폴백 동작으로 처리됨).
  await Promise.all([pipeline.loadSession(sessionId), loadActionCatalog().catch(() => {})]);
  // loadSession()은 실패해도 예외를 던지지 않고 sessionLoadStatus="error"만 남긴 채 return한다
  // (Qodo 리뷰) — 이 상태를 먼저 확인하지 않으면 네트워크·API 오류까지 "세션 없음"으로
  // 오분류해 uploadError에 담긴 실제 오류 메시지가 사라진다.
  if (pipeline.sessionLoadStatus === "error") {
    bootStatus.value = "error";
    return;
  }
  if (!pipeline.recommendation) {
    bootStatus.value = "not-found";
    return;
  }
  bootStatus.value = "ready";
  document.title = `${t("recommendFlow.title")} v${pipeline.recommendation.version} - A360 Assistant`;
});

const steps = computed(() => pipeline.recommendation?.recommendation?.steps ?? []);
const hasActions = computed(() => steps.value.some((s) => (s.actions?.length ?? 0) > 0));

const flowCanvasRef = ref(null);
const canvasDirty = ref(false);
const canvasSaving = ref(false);
const canvasUnplacedCount = ref(0);

// "이미지로 저장" — FlowCanvas.getImageCaptureTarget()이 vue-flow 공식 레시피대로 전체 노드
// 바운딩 박스 기준 고해상도 캡처 대상(엘리먼트+목표 width/height/transform)을 계산해 준다.
// 화면에 보이는 팬/줌과 무관하게 항상 같은 결과가 나오고, 실제 화면을 건드리지 않으니 캡처
// 후 되돌릴 것도 없다.
const capturingImage = ref(false);
const imageExportError = ref("");

async function downloadFlowImage() {
  if (capturingImage.value) return;
  const target = flowCanvasRef.value?.getImageCaptureTarget();
  if (!target) return;
  capturingImage.value = true;
  imageExportError.value = "";
  try {
    const blob = await toBlob(target.element, {
      backgroundColor: target.backgroundColor,
      width: target.width,
      height: target.height,
      style: target.style,
    });
    if (!blob) throw new Error("empty blob");
    const version = pipeline.recommendation?.version;
    triggerBlobDownload(blob, `recommendation-flow-${pipeline.sessionId}${version != null ? `-v${version}` : ""}.png`);
  } catch {
    imageExportError.value = t("recommendFlow.exportImageFailed");
  } finally {
    capturingImage.value = false;
  }
}

// "DOCX로 내보내기" — 흐름도(FR-18)는 이 창에서만 렌더되므로 서버가 직접 캡처할 수 없다
// (RPA-296). 백엔드는 이미지를 고정 폭(6.3in)으로만 삽입하고 높이는 원본 비율 그대로 따라가는데,
// Word는 페이지보다 큰 인라인 그림을 다음 페이지로 이어 그려주지 않고 페이지 경계에서 그냥
// 잘라버린다(실측 확인됨) — downloadFlowImage와 같은 세로 한 줄 레이아웃을 그대로 캡처해 한 장만
// 보내면 단계가 많은 흐름도는 반드시 잘린다. RPA-296 후속으로 백엔드가 흐름도 이미지를 여러 장
// (flow_images) 받아 장마다 페이지 나눔을 넣어 삽입하도록 바뀌었으므로, 프론트는 스텝 경계에서
// 페이지 단위로 잘라(prepareExportPages/captureExportPage, 세로 한 줄 모양은 그대로 유지 —
// 컬럼으로 욱여넣지 않아 글자 크기가 항상 일정하다) 페이지 수만큼 따로 캡처해 배열로 보낸다.
// 캡처 실패해도 문서 자체는 계속 내려받아야 하므로 던지지 않고 이미지 없이 이어간다.
const exportingDocx = ref(false);
const docxExportError = ref("");

async function downloadFlowDocx() {
  if (exportingDocx.value) return;
  exportingDocx.value = true;
  docxExportError.value = "";
  try {
    const flowImageBlobs = [];
    try {
      const pageCount = flowCanvasRef.value?.prepareExportPages() ?? 0;
      for (let i = 0; i < pageCount; i++) {
        const target = await flowCanvasRef.value.captureExportPage(i);
        if (!target) continue;
        const blob = await toBlob(target.element, {
          backgroundColor: target.backgroundColor,
          width: target.width,
          height: target.height,
          style: target.style,
        });
        if (blob) flowImageBlobs.push(blob);
      }
    } catch {
      flowImageBlobs.length = 0;
    } finally {
      flowCanvasRef.value?.endExportCapture();
    }
    await downloadRecommendationDocx(pipeline.sessionId, pipeline.recommendation.version, flowImageBlobs);
  } catch (err) {
    docxExportError.value = err?.message ?? t("recommendFlow.exportDocxFailed");
  } finally {
    exportingDocx.value = false;
  }
}

// "편집" 버튼을 눌러야만 텍스트 수정·드래그 재정렬이 가능하다 — 기존 모달과 동일한 정책.
const isEditMode = ref(false);

function startEditMode() {
  isEditMode.value = true;
}

function exitEditMode() {
  isEditMode.value = false;
}

function discardCanvasEdits() {
  flowCanvasRef.value?.discard();
  isEditMode.value = false;
}

// 좌측 패키지/액션 피커를 클릭하면 캔버스 여백에 "미배치" 카드로 놓인다 — 사용자가 그 카드를
// 흐름도 위 원하는 자리로 직접 끌어다 놓아야 실제로 편입된다(FlowCanvas.addUnplacedAction).
// 피커에서 곧바로 흐름도로 드래그하는 경우는 FlowCanvas가 네이티브 DnD로 직접 받으므로
// 이 창은 관여하지 않는다.
function insertCatalogAction(descriptor) {
  flowCanvasRef.value?.addUnplacedAction(descriptor);
}

async function saveCanvasEdits() {
  await flowCanvasRef.value?.save((editedSteps, summary) =>
    pipeline.saveRecommendationEdit({ ...pipeline.recommendation.recommendation, steps: editedSteps }, summary),
  );
}

// 닫기는 이제 이 창 자체의 OS 타이틀바 X 버튼(별도 창이라 항상 있다)이 전담한다 — 저장 안 한
// 편집이 있는 채로 그 버튼이나 Alt+F4로 닫으면 브라우저 기본 확인창으로 한 번 막아준다.
window.addEventListener("beforeunload", (event) => {
  if (!canvasDirty.value) return;
  event.preventDefault();
  event.returnValue = "";
});

// ----- 버전 이력 -----
const showHistory = ref(false);
const revertingVersion = ref(null);

// grid-template-rows(0fr↔1fr)로 열고 닫으면 목록 내용의 max-content 높이를 매 프레임 다시
// 재는 과정에서 버벅였다 — 대신 실제 픽셀 높이(scrollHeight) 사이를 선형 보간하는 표준 기법을 쓴다.
function onHistoryEnter(el, done) {
  el.style.height = "0px";
  const targetHeight = el.scrollHeight;
  requestAnimationFrame(() => {
    el.style.transition = "height 0.22s ease";
    el.style.height = `${targetHeight}px`;
  });
  el.addEventListener("transitionend", function onEnd(event) {
    if (event.propertyName !== "height") return;
    el.removeEventListener("transitionend", onEnd);
    el.style.height = "";
    el.style.transition = "";
    done();
  });
}

function onHistoryLeave(el, done) {
  el.style.height = `${el.scrollHeight}px`;
  requestAnimationFrame(() => {
    el.style.transition = "height 0.22s ease";
    el.style.height = "0px";
  });
  el.addEventListener("transitionend", function onEnd(event) {
    if (event.propertyName !== "height") return;
    el.removeEventListener("transitionend", onEnd);
    done();
  });
}

const KNOWN_SOURCES = ["llm", "drag", "chat", "feedback"];

function versionDescription(v) {
  if (v.change_summary) return v.change_summary;
  if (v.source && KNOWN_SOURCES.includes(v.source)) return t(`recommendFlow.source.${v.source}`);
  return v.source || "";
}

// 백엔드에 개별 버전 조회 API가 없어, 이 창에서 캐시해 둔 트리가 있는 버전만 되돌릴 수 있다.
function canRevert(v) {
  return v.version !== pipeline.recommendation?.version && !!pipeline.recommendTreesByVersion[v.version];
}

async function revertTo(version) {
  if (revertingVersion.value !== null) return;
  revertingVersion.value = version;
  await pipeline.revertToRecommendationVersion(version);
  revertingVersion.value = null;
}

const formatDate = formatDateShort;
</script>

<template>
  <div class="flow-window">
    <header class="modal__header">
      <h2>
        {{ t("recommendFlow.title") }}
        <span v-if="pipeline.recommendation?.version" class="flow-version-badge">
          v{{ pipeline.recommendation.version }}
        </span>
      </h2>
    </header>

    <div v-if="bootStatus === 'loading'" class="flow-window__status">{{ t("app.authChecking") }}</div>
    <div v-else-if="bootStatus === 'unauthorized'" class="flow-window__status">
      {{ t("recommendFlow.windowUnauthorized") }}
    </div>
    <div v-else-if="bootStatus === 'not-found'" class="flow-window__status">
      {{ t("recommendFlow.windowNotFound") }}
    </div>
    <div v-else-if="bootStatus === 'error'" class="flow-window__status">
      {{ pipeline.uploadError || t("recommendFlow.windowLoadError") }}
    </div>

    <div v-else class="flow-window__body">
      <div class="flow-toolbar">
        <p class="flow-hint">
          {{ t("recommendFlow.hint") }}
          <span v-if="canvasUnplacedCount > 0" class="flow-save-status flow-save-status--warning">
            {{ t("recommendFlow.unplacedHint", { count: canvasUnplacedCount }) }}
          </span>
          <span v-else-if="canvasDirty" class="flow-save-status">{{ t("recommendFlow.unsavedHint") }}</span>
        </p>
        <div class="flow-toolbar__actions">
          <template v-if="isEditMode">
            <template v-if="canvasDirty">
              <button type="button" class="btn btn--outline" :disabled="canvasSaving" @click="discardCanvasEdits">
                {{ t("recommendFlow.discard") }}
              </button>
              <button
                type="button"
                class="btn btn--primary"
                :disabled="canvasSaving || canvasUnplacedCount > 0"
                :title="canvasUnplacedCount > 0 ? t('recommendFlow.unplacedHint', { count: canvasUnplacedCount }) : ''"
                @click="saveCanvasEdits"
              >
                {{ canvasSaving ? t("recommendFlow.saving") : t("recommendFlow.save") }}
              </button>
            </template>
            <button v-else type="button" class="btn btn--outline" @click="exitEditMode">
              {{ t("recommendFlow.exitEdit") }}
            </button>
          </template>
          <button v-else type="button" class="btn btn--primary" :disabled="!hasActions" @click="startEditMode">
            {{ t("recommendFlow.edit") }}
          </button>
          <button type="button" class="btn btn--outline" @click="showHistory = !showHistory">
            {{ t("recommendFlow.versionHistory") }}
          </button>
          <button
            type="button"
            class="btn btn--outline"
            :disabled="!hasActions || capturingImage"
            @click="downloadFlowImage"
          >
            {{ capturingImage ? t("recommendFlow.exportingImage") : t("recommendFlow.exportImage") }}
          </button>
          <button
            type="button"
            class="btn btn--outline"
            :disabled="!hasActions || exportingDocx"
            @click="downloadFlowDocx"
          >
            {{ exportingDocx ? t("recommendFlow.exportingDocx") : t("recommendFlow.exportDocx") }}
          </button>
        </div>
      </div>

      <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>
      <p v-if="imageExportError" class="upload-error">{{ imageExportError }}</p>
      <p v-if="docxExportError" class="upload-error">{{ docxExportError }}</p>

      <Transition :css="false" @enter="onHistoryEnter" @leave="onHistoryLeave">
        <div v-if="showHistory" class="flow-history-collapse">
          <div class="flow-history">
            <h3 class="flow-history__title">{{ t("recommendFlow.versionHistory") }}</h3>
            <p v-if="!pipeline.recommendVersions.length" class="flow-history__empty">
              {{ t("recommendFlow.noVersions") }}
            </p>
            <ol v-else class="flow-history__list">
              <li v-for="v in pipeline.recommendVersions" :key="v.id" class="flow-history__item">
                <div class="flow-history__meta">
                  <strong>v{{ v.version }}</strong>
                  <span v-if="v.version === pipeline.recommendation?.version" class="flow-history__current">
                    {{ t("recommendFlow.current") }}
                  </span>
                  <span class="flow-history__desc">{{ versionDescription(v) }}</span>
                  <time class="flow-history__date">{{ formatDate(v.created_at) }}</time>
                </div>
                <button
                  v-if="canRevert(v)"
                  type="button"
                  class="btn btn--outline flow-history__revert"
                  :disabled="revertingVersion !== null"
                  @click="revertTo(v.version)"
                >
                  {{ revertingVersion === v.version ? t("recommendFlow.reverting") : t("recommendFlow.revert") }}
                </button>
              </li>
            </ol>
            <p class="flow-history__hint">
              {{ t("recommendFlow.revertHint") }}
            </p>
          </div>
        </div>
      </Transition>

      <div v-if="hasActions" class="flow-window__workspace">
        <ActionCatalogPanel v-if="isEditMode" @insert="insertCatalogAction" />
        <div class="flow-window__canvas">
          <FlowCanvas
            ref="flowCanvasRef"
            :steps="steps"
            :editable="isEditMode"
            @update:dirty="canvasDirty = $event"
            @update:saving="canvasSaving = $event"
            @update:unplaced-count="canvasUnplacedCount = $event"
          />
          <!-- DOCX 캡처 동안 FlowCanvas가 페이지 조각을 순서대로 잠깐씩 그렸다가 원래 화면으로
               돌아온다 — 그 전환이 화면에 그대로 보이면 어색하므로 캡처하는 동안 가려 둔다. -->
          <div v-if="exportingDocx" class="flow-window__canvas-overlay">
            <span class="analyzing-state__spinner" aria-hidden="true"></span>
            <span>{{ t("recommendFlow.exportingDocx") }}</span>
          </div>
        </div>
      </div>
      <p v-else class="modal__empty">{{ t("recommendFlow.noResults") }}</p>

      <p v-if="pipeline.recommendation?.recommendation?.notes" class="flow-notes">
        <strong>{{ t("common.notesLabel") }}</strong> {{ pipeline.recommendation.recommendation.notes }}
      </p>
    </div>
  </div>
</template>
