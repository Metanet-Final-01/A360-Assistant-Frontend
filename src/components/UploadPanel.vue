<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { useSettingsStore } from "../stores/settings";
import { formatBytes } from "../utils/format";
import { formatDateLabel } from "../utils/dateFormat";
import { analysisStats } from "../utils/analysisSummary";
import { useFitTitle } from "../composables/useFitTitle";

const pipeline = usePipelineStore();
const settings = useSettingsStore();
const { t } = useI18n();

const titleRef = ref(null);
useFitTitle(titleRef, () => t("upload.title"));

// 대상 시스템 선택 드롭다운 — 지금은 A360 흐름도 제작만 지원하지만, 추후 다른 시스템도
// 지원할 걸 대비해 미리 선택 지점을 만들어 둔다. 목록에 항목이 A360 하나뿐이라 실질적으로는
// 늘 고정이고, 드롭다운 자체가 향후 확장 지점을 보여주는 역할이다.
const SYSTEMS = [{ id: "a360", label: "A360" }];
const selectedSystemId = ref(SYSTEMS[0].id);
const selectedSystem = computed(
  () => SYSTEMS.find((s) => s.id === selectedSystemId.value) ?? SYSTEMS[0],
);
const systemMenuOpen = ref(false);

function selectSystem(id) {
  systemMenuOpen.value = false;
  selectedSystemId.value = id;
}

function closeSystemMenuOnOutsideClick(event) {
  if (systemMenuOpen.value && !event.target.closest(".panel__header-system")) {
    systemMenuOpen.value = false;
  }
}

function closeSystemMenuOnEscape(event) {
  if (systemMenuOpen.value && event.key === "Escape") {
    systemMenuOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", closeSystemMenuOnOutsideClick);
  window.addEventListener("keydown", closeSystemMenuOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeSystemMenuOnOutsideClick);
  window.removeEventListener("keydown", closeSystemMenuOnEscape);
});

const isDragging = ref(false);
const fileInputRef = ref(null);
const inputMode = ref("file"); // file | text
const textDraft = ref("");
// 분석이 끝나면 업로드 입력(탭·드롭존)은 더 볼 일이 없는데도 화면을 차지해 아래 진행 상태·
// 요약이 밀린다 — 패널 자체 높이는 고정(.panel--wide)이라 접어도 패널 크기는 그대로고,
// 접힌 만큼 진행 상태·요약이 위로 올라오는 효과만 낸다.
const uploadSectionCollapsed = ref(false);

// 텍스트 입력은 store가 아니라 이 컴포넌트가 로컬로 들고 있어서, 세션 전환(loadSession)이나
// "새 요청 입력"처럼 store 쪽에서 pipeline.file이 지워지는 경로를 여기서 따로 다 챙겨 부르기보다,
// file이 사라지는 시점 자체를 감시해서 지운다. 다만 watch는 값이 실제로 바뀔 때만 발동해서
// file이 이미 null인 상태(예: 파일 없이 텍스트만 쓰던 중)의 리셋은 못 잡는다 — 그 경우는
// switchMode에서 명시적으로 지운다.
// 또한 세션 이력을 다시 열었을 때(loadSession) 어느 탭이 활성이어야 하는지도 여기서 함께
// 정한다 — 자연어 요청 문서는 백엔드가 파일명을 "{제목}.txt"로 저장해(ext==="txt") 파일
// 업로드와 구분된다(RPA-264).
watch(
  () => pipeline.file,
  (file) => {
    if (!file) {
      textDraft.value = "";
      return;
    }
    inputMode.value = file.ext === "txt" ? "text" : "file";
  },
);

const fileSizeLabel = computed(() => (pipeline.file ? formatBytes(pipeline.file.size) : ""));
const uploadedAtLabel = computed(() => formatDateLabel(pipeline.document?.created_at));

// 비전 보강이 parsed_content를 갱신하는 도중에 분석이 먼저 시작되면 보강 결과가 반영되지
// 않은 채로 분석이 진행될 수 있어(RPA-264), 보강이 끝날 때까지는 분석 시작을 막는다.
const canStartAnalysis = computed(
  () =>
    pipeline.document?.status === "parsed" &&
    pipeline.analysisStatus === "idle" &&
    pipeline.visionStatus !== "enriching",
);

function openFileDialog() {
  fileInputRef.value?.click();
}

function handleFiles(fileList) {
  const file = fileList?.[0];
  if (file) pipeline.selectFile(file);
}

function onDrop(event) {
  isDragging.value = false;
  handleFiles(event.dataTransfer?.files);
}

// 파일 드래그일 때만 드롭존을 하이라이트한다 — 패널 재배치 그립이나
// 분석 결과 카드 드래그가 지나갈 때는 반응하지 않는다.
function onDropzoneDragOver(event) {
  isDragging.value = !!event.dataTransfer?.types?.includes("Files");
}

function onFileChange(event) {
  handleFiles(event.target.files);
  event.target.value = "";
}

// 텍스트 입력은 파일과 달리 파싱이 곧장 끝나(status가 바로 "parsed") 검토할 추출 결과가
// 따로 없다 — 그래서 제출 즉시 분석까지 이어 붙여, 파일 업로드처럼 "분석 시작"을 한 번 더
// 눌러야 하는 중간 단계 없이 바로 분석 진행 상태로 넘어가게 한다.
async function handleTextSubmit() {
  if (!textDraft.value.trim()) return;
  const doc = await pipeline.submitTextRequest(textDraft.value);
  if (doc?.status === "parsed") {
    pipeline.startAnalysis();
  }
}

function switchMode(mode) {
  inputMode.value = mode;
  textDraft.value = "";
  pipeline.resetUpload();
}

function resetUploadSection() {
  // 접힌 상태로 리셋하면, 이 토글 버튼 자체가 analysisStatus==='idle'일 때 사라져서
  // 다시 펼칠 방법이 없어진다 — 새 문서/요청을 시작할 땐 항상 펼쳐 둔다.
  uploadSectionCollapsed.value = false;
  pipeline.resetUpload();
}

// ----- 분석 진행 상태 (파이프라인 실제 상태를 그대로 비춘다) -----
// 각 행의 state는 done | running | pending | error 넷 중 하나이며, 오른쪽 상태 칩과
// 왼쪽 아이콘(체크/점/빈 원/느낌표) 색을 함께 결정한다. 임의로 만들어 낸 단계는 없고
// 전부 store가 실제로 들고 있는 상태값에서 파생된다.
const stepCount = computed(() => pipeline.analysis?.steps?.length ?? 0);

const fileCheckState = computed(() => {
  if (pipeline.uploadStatus === "error") return "error";
  if (pipeline.uploadStatus === "uploading") return "running";
  return pipeline.file ? "done" : "pending";
});

const extractState = computed(() => {
  const status = pipeline.document?.status;
  if (status === "failed") return "error";
  if (status === "parsed") return "done";
  if (pipeline.uploadStatus === "uploading") return "running";
  return "pending";
});

const visionState = computed(() => {
  const status = pipeline.visionStatus;
  if (status === "enriching") return "running";
  if (status === "done") return "done";
  if (status === "error") return "error";
  return "pending";
});

const analyzeState = computed(() => {
  const status = pipeline.analysisStatus;
  if (status === "analyzing") return "running";
  if (status === "done") return "done";
  if (status === "error") return "error";
  return "pending";
});

const flowState = computed(() => {
  if (pipeline.liveActive || pipeline.recommendStatus === "generating") return "running";
  if (pipeline.recommendStatus === "error") return "error";
  return pipeline.recommendation ? "done" : "pending";
});

const progressRows = computed(() => {
  const rows = [
    {
      key: "validate",
      label: t("upload.progress.validate"),
      state: fileCheckState.value,
      detail: pipeline.uploadStatus === "error" ? pipeline.uploadError : "",
    },
    {
      key: "extract",
      label: t("upload.progress.extract"),
      state: extractState.value,
      detail:
        extractState.value === "done"
          ? pipeline.document?.page_count != null
            ? t("upload.progress.extractDone", { page: pipeline.document.page_count })
            : t("upload.status.processedDone")
          : "",
    },
  ];

  // 비전 보강은 PDF/PPT/PPTX에서만 도는 선택 단계라, 실제로 시작된 세션에서만 줄을 낸다 —
  // 해당 없는 문서에서 "대기"로 영영 남아 있으면 멈춘 것처럼 보인다.
  if (pipeline.visionStatus !== "idle") {
    rows.push({
      key: "vision",
      label: t("upload.progress.vision"),
      state: visionState.value,
      detail:
        visionState.value === "running"
          ? pipeline.visionStage || ""
          : visionState.value === "error"
            ? pipeline.visionError
            : pipeline.enrichedPages?.length
              ? t("upload.vision.done", { count: pipeline.enrichedPages.length }, pipeline.enrichedPages.length)
              : t("upload.vision.noneNeeded"),
    });
  }

  rows.push(
    {
      key: "analyze",
      label: t("upload.progress.analyze"),
      state: analyzeState.value,
      detail:
        analyzeState.value === "running"
          ? pipeline.liveCaption || pipeline.analysisStage || t("upload.progress.analyzeHint")
          : analyzeState.value === "error"
            ? pipeline.analysisError
            : analyzeState.value === "done"
              ? t("upload.progress.analyzeDone", { count: stepCount.value })
              : "",
    },
    {
      key: "flow",
      label: t("upload.progress.flow"),
      state: flowState.value,
      detail:
        flowState.value === "running"
          ? pipeline.liveCaption || pipeline.recommendStage || ""
          : flowState.value === "error"
            ? pipeline.recommendError
            : flowState.value === "done"
              ? t("upload.progress.flowDone", { version: pipeline.recommendation.version })
              : "",
    },
  );

  return rows;
});

const PROGRESS_STATE_LABELS = {
  done: "upload.progress.stateDone",
  running: "upload.progress.stateRunning",
  pending: "upload.progress.statePending",
  error: "upload.progress.stateError",
};

function stateLabel(state) {
  return t(PROGRESS_STATE_LABELS[state]);
}

// ----- 분석 요약 -----
// 분석이 끝나야 의미가 있는 수치라 analysis가 채워진 뒤에만 보여준다. 모델/토큰은
// 단계 수처럼 문서에서 나온 값이 아니라 이번 세션의 실행 메타라, 값이 있을 때만 줄을 낸다.
const stats = computed(() => analysisStats(pipeline.analysis?.steps));
const hasAnalysis = computed(() => !!pipeline.analysis?.steps);

const modelLabel = computed(() => {
  const id = settings.agentVersion;
  if (!id) return "";
  return settings.agentVersions.find((v) => v.id === id)?.label ?? id;
});

const tokenLabel = computed(() => {
  const used = pipeline.usageGauge?.intake_tokens;
  return used == null ? "" : t("upload.summary.tokenValue", { tokens: used.toLocaleString() });
});
</script>

<template>
  <section class="panel panel--wide" aria-labelledby="upload-panel-title" data-tour="upload">
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="upload-panel-title" ref="titleRef">{{ t("upload.title") }}</h2>
      <div class="panel__header-actions">
        <div class="panel__header-system">
          <button
            type="button"
            class="btn panel__header-btn"
            :title="t('upload.systemSelectTitle')"
            :aria-label="t('upload.systemSelectTitle')"
            :aria-expanded="systemMenuOpen"
            aria-haspopup="listbox"
            @click="systemMenuOpen = !systemMenuOpen"
          >
            {{ selectedSystem.label }}
            <svg
              class="panel__header-chevron"
              :class="{ 'panel__header-chevron--open': systemMenuOpen }"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <Transition name="fade-down">
            <div
              v-if="systemMenuOpen"
              class="panel__header-menu"
              role="listbox"
              :aria-label="t('upload.systemSelectTitle')"
            >
              <button
                v-for="system in SYSTEMS"
                :key="system.id"
                type="button"
                role="option"
                class="panel__header-menu-item"
                :aria-selected="system.id === selectedSystemId"
                @click="selectSystem(system.id)"
              >
                {{ system.label }}
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <div class="panel__body">
      <div
        class="upload-section-body"
        :class="{ 'upload-section-body--collapsed': uploadSectionCollapsed }"
        :aria-hidden="uploadSectionCollapsed"
        :inert="uploadSectionCollapsed"
      >
       <div class="upload-section-body__inner">
        <div class="upload-mode-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="inputMode === 'file'"
            class="upload-mode-toggle__btn"
            :class="{ 'upload-mode-toggle__btn--active': inputMode === 'file' }"
            @click="switchMode('file')"
          >
            {{ t("upload.fileTab") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="inputMode === 'text'"
            class="upload-mode-toggle__btn"
            :class="{ 'upload-mode-toggle__btn--active': inputMode === 'text' }"
            @click="switchMode('text')"
          >
            {{ t("upload.textTab") }}
          </button>
        </div>

        <div
          v-if="inputMode === 'file' && !pipeline.file"
          class="dropzone"
          :class="{ 'dropzone--active': isDragging }"
          role="button"
          tabindex="0"
          @click="openFileDialog"
          @keydown.enter="openFileDialog"
          @dragover.prevent="onDropzoneDragOver"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <svg class="dropzone__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v12m0-12 4 4m-4-4-4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <p class="dropzone__text">
            <strong>{{ t("upload.dropzone.fileTypes") }}</strong> {{ t("upload.dropzone.hint") }}
          </p>
          <span class="dropzone__button">{{ t("upload.dropzone.selectButton") }}</span>
          <input
            ref="fileInputRef"
            type="file"
            accept=".pdf,.ppt,.pptx,.docx"
            class="sr-only"
            @change="onFileChange"
          />
        </div>

        <div v-else-if="inputMode === 'text' && !pipeline.file" class="text-input-area">
          <textarea
            v-model="textDraft"
            class="text-input-area__field"
            rows="6"
            :placeholder="t('upload.textPlaceholder')"
          ></textarea>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!textDraft.trim()"
            @click="handleTextSubmit"
          >
            {{ t("upload.startFromText") }}
          </button>
        </div>

        <p v-if="pipeline.uploadStatus === 'error'" class="upload-error">
          {{ pipeline.uploadError }}
        </p>

        <div class="uploaded-doc" v-if="pipeline.file">
          <h3 class="uploaded-doc__label">{{ inputMode === "text" ? t("upload.inputRequestLabel") : t("upload.uploadedDocLabel") }}</h3>

          <div class="doc-card">
            <div class="doc-card__row">
              <span class="doc-card__icon">{{ pipeline.file.ext.toUpperCase() }}</span>
              <span class="doc-card__name" :title="pipeline.file.name">{{ pipeline.file.name }}</span>
              <span class="doc-card__size">{{ fileSizeLabel }}</span>
            </div>
            <div class="doc-card__row doc-card__row--status">
              <span
                v-if="pipeline.uploadStatus === 'uploading'"
                class="doc-card__state doc-card__state--running"
              >
                <span class="doc-card__spinner" aria-hidden="true"></span>
                {{ t("upload.status.uploading") }}
              </span>
              <span
                v-else-if="pipeline.uploadStatus === 'error'"
                class="doc-card__state doc-card__state--error"
              >
                {{ t("upload.status.failed") }}
              </span>
              <span v-else class="doc-card__state doc-card__state--done">
                {{ t("upload.status.uploadDone") }}
              </span>
            </div>
            <div v-if="uploadedAtLabel" class="doc-card__row doc-card__row--meta">
              <span class="doc-card__meta-label">{{ t("upload.uploadedAt") }}</span>
              <span class="doc-card__meta-value">{{ uploadedAtLabel }}</span>
            </div>
          </div>

          <div class="upload-actions">
            <button
              type="button"
              class="btn btn--primary"
              :disabled="!canStartAnalysis"
              @click="pipeline.startAnalysis"
            >
              <span v-if="pipeline.analysisStatus === 'analyzing'">{{ t("upload.analysis.progress") }}</span>
              <span v-else-if="pipeline.analysisStatus === 'done'">{{ t("upload.analysis.done") }}</span>
              <span v-else>{{ t("upload.analysis.start") }}</span>
            </button>
          </div>
        </div>
       </div>
      </div>

      <div v-if="pipeline.file" class="upload-section-toggle">
        <button type="button" class="btn btn--text" @click="resetUploadSection">
          {{ inputMode === "text" ? t("upload.newTextRequest") : t("upload.newDocumentUpload") }}
        </button>
        <button
          v-if="pipeline.analysisStatus !== 'idle'"
          type="button"
          class="upload-section-toggle__btn"
          :aria-expanded="!uploadSectionCollapsed"
          @click="uploadSectionCollapsed = !uploadSectionCollapsed"
        >
          {{ uploadSectionCollapsed ? t("upload.expandSection") : t("upload.collapseSection") }}
          <svg
            class="upload-section-toggle__chevron"
            :class="{ 'upload-section-toggle__chevron--collapsed': uploadSectionCollapsed }"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <!-- 분석 진행 상태 — 업로드부터 흐름도 생성까지 파이프라인 각 단계의 실제 상태 -->
      <section v-if="pipeline.file" class="side-card" aria-labelledby="upload-progress-title">
        <h3 id="upload-progress-title" class="side-card__title">{{ t("upload.progress.title") }}</h3>
        <ul class="progress-list">
          <li
            v-for="row in progressRows"
            :key="row.key"
            class="progress-list__item"
            :class="`progress-list__item--${row.state}`"
          >
            <span class="progress-list__icon" aria-hidden="true">
              <svg v-if="row.state === 'done'" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" fill="currentColor" />
                <path
                  d="M8 12.4l2.6 2.6L16 9.6"
                  stroke="var(--surface)"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg v-else-if="row.state === 'error'" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" fill="currentColor" />
                <path d="M12 7.5v5.5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round" />
                <circle cx="12" cy="16.4" r="1.1" fill="var(--surface)" />
              </svg>
              <span v-else-if="row.state === 'running'" class="progress-list__dot"></span>
              <svg v-else viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" />
              </svg>
            </span>
            <span class="progress-list__body">
              <span class="progress-list__label">{{ row.label }}</span>
              <span v-if="row.detail" class="progress-list__detail">{{ row.detail }}</span>
            </span>
            <span class="progress-list__state">
              <span v-if="row.state === 'running'" class="progress-list__state-spinner" aria-hidden="true"></span>
              {{ stateLabel(row.state) }}
            </span>
          </li>
        </ul>
      </section>

      <!-- 분석 요약 — 분석 결과에서 파생한 수치와 이번 세션의 실행 메타 -->
      <section v-if="hasAnalysis" class="side-card" aria-labelledby="upload-summary-title">
        <h3 id="upload-summary-title" class="side-card__title">{{ t("upload.summary.title") }}</h3>
        <dl class="stat-list">
          <div class="stat-list__row">
            <dt>{{ t("upload.summary.steps") }}</dt>
            <dd>{{ stats.stepCount }}</dd>
          </div>
          <div class="stat-list__row">
            <dt>{{ t("upload.summary.systems") }}</dt>
            <dd>{{ stats.systemCount }}</dd>
          </div>
          <div class="stat-list__row">
            <dt>{{ t("upload.summary.inputs") }}</dt>
            <dd>{{ stats.inputCount }}</dd>
          </div>
          <div class="stat-list__row">
            <dt>{{ t("upload.summary.outputs") }}</dt>
            <dd>{{ stats.outputCount }}</dd>
          </div>
          <div v-if="modelLabel" class="stat-list__row">
            <dt>{{ t("upload.summary.model") }}</dt>
            <dd class="stat-list__value--text">{{ modelLabel }}</dd>
          </div>
          <div v-if="tokenLabel" class="stat-list__row">
            <dt>{{ t("upload.summary.tokens") }}</dt>
            <dd class="stat-list__value--text">{{ tokenLabel }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <div class="panel__bottom-fade" aria-hidden="true"></div>
  </section>
</template>
