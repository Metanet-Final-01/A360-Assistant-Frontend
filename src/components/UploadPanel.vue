<script setup>
import { computed, ref } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { formatBytes } from "../utils/format";

const pipeline = usePipelineStore();

const isDragging = ref(false);
const fileInputRef = ref(null);
const inputMode = ref("file"); // file | text
const textDraft = ref("");

const fileSizeLabel = computed(() =>
  pipeline.file ? formatBytes(pipeline.file.size) : "",
);

const canStartAnalysis = computed(
  () =>
    pipeline.document?.status === "parsed" &&
    pipeline.analysisStatus === "idle",
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

function onFileChange(event) {
  handleFiles(event.target.files);
  event.target.value = "";
}

function handleTextSubmit() {
  if (!textDraft.value.trim()) return;
  pipeline.submitTextRequest(textDraft.value);
}

function switchMode(mode) {
  inputMode.value = mode;
  pipeline.resetUpload();
  textDraft.value = "";
}
</script>

<template>
  <section class="panel" aria-labelledby="upload-panel-title">
    <header class="panel__header">
      <h2 id="upload-panel-title">업무정의서 업로드</h2>
    </header>

    <div class="panel__body">
      <div class="upload-mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="inputMode === 'file'"
          class="upload-mode-toggle__btn"
          :class="{ 'upload-mode-toggle__btn--active': inputMode === 'file' }"
          @click="switchMode('file')"
        >
          파일 업로드
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="inputMode === 'text'"
          class="upload-mode-toggle__btn"
          :class="{ 'upload-mode-toggle__btn--active': inputMode === 'text' }"
          @click="switchMode('text')"
        >
          텍스트로 입력
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
        @dragover.prevent="isDragging = true"
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
          <strong>PDF · PPT · PPTX · DOCX</strong> 파일을 여기에 드래그하거나<br />
          클릭하여 선택하세요
        </p>
        <span class="dropzone__button">파일 선택</span>
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
          placeholder="처리하고 싶은 업무 내용을 자연어로 설명해주세요. 예: 매일 아침 네이버 금융에서 국내 금 시세를 조회해 엑셀로 정리하고 담당자에게 메일로 보낸다."
        ></textarea>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!textDraft.trim()"
          @click="handleTextSubmit"
        >
          분석 시작하기
        </button>
      </div>

      <p v-if="pipeline.uploadStatus === 'error'" class="upload-error">
        {{ pipeline.uploadError }}
      </p>

      <div class="uploaded-doc" v-if="pipeline.file">
        <h3 class="uploaded-doc__label">{{ inputMode === "text" ? "입력된 요청" : "업로드된 문서" }}</h3>

        <div class="doc-card">
          <span class="doc-card__icon">{{ pipeline.file.ext.toUpperCase() }}</span>
          <div class="doc-card__info">
            <span class="doc-card__name">{{ pipeline.file.name }}</span>
            <span class="doc-card__size">{{ fileSizeLabel }}</span>
          </div>
          <span
            v-if="pipeline.uploadStatus === 'uploading'"
            class="doc-card__status doc-card__status--loading"
            aria-label="업로드 중"
          ></span>
          <svg
            v-else-if="pipeline.uploadStatus === 'error'"
            class="doc-card__status doc-card__status--done"
            viewBox="0 0 24 24"
            fill="none"
            aria-label="업로드 실패"
          >
            <circle cx="12" cy="12" r="10" fill="var(--danger-bg)" />
            <path
              d="M9 9l6 6m0-6-6 6"
              stroke="var(--danger)"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <svg
            v-else
            class="doc-card__status doc-card__status--done"
            viewBox="0 0 24 24"
            fill="none"
            aria-label="업로드 완료"
          >
            <circle cx="12" cy="12" r="10" fill="#e8f8ee" />
            <path
              d="M8 12.5l2.5 2.5L16 9.5"
              stroke="#1f9d55"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <Transition name="fade-up">
          <ul class="extraction-meta" v-if="pipeline.document?.status === 'parsed'">
            <li v-if="pipeline.document.page_count != null">
              · 파싱 완료 · 페이지 {{ pipeline.document.page_count }}
            </li>
            <li v-else>· 처리 완료</li>
            <li v-for="(warning, idx) in pipeline.document.warnings" :key="idx" class="extraction-meta__warning">
              ⚠ {{ warning }}
            </li>
          </ul>
        </Transition>

        <div class="upload-actions">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!canStartAnalysis"
            @click="pipeline.startAnalysis"
          >
            <span v-if="pipeline.analysisStatus === 'analyzing'">분석 진행 중…</span>
            <span v-else-if="pipeline.analysisStatus === 'done'">분석 완료</span>
            <span v-else>분석 시작</span>
          </button>
          <button type="button" class="btn btn--text" @click="pipeline.resetUpload">
            {{ inputMode === "text" ? "새 요청 입력" : "새 문서 업로드" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
