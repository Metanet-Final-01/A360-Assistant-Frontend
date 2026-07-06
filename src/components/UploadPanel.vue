<script setup>
import { computed, ref } from "vue";
import { workflow, selectFile, startAnalysis, resetUpload, formatBytes } from "../store/workflow";

const isDragging = ref(false);
const fileInputRef = ref(null);

const fileSizeLabel = computed(() =>
  workflow.file ? formatBytes(workflow.file.size) : "",
);

const canStartAnalysis = computed(
  () =>
    workflow.uploadStatus === "uploaded" &&
    !!workflow.extraction &&
    workflow.analysisStatus === "idle",
);

function openFileDialog() {
  fileInputRef.value?.click();
}

function handleFiles(fileList) {
  const file = fileList?.[0];
  if (file) selectFile(file);
}

function onDrop(event) {
  isDragging.value = false;
  handleFiles(event.dataTransfer?.files);
}

function onFileChange(event) {
  handleFiles(event.target.files);
  event.target.value = "";
}
</script>

<template>
  <section class="panel" aria-labelledby="upload-panel-title">
    <header class="panel__header">
      <h2 id="upload-panel-title">① 업무정의서 업로드</h2>
    </header>

    <div class="panel__body">
      <div
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
          <strong>PDF · PPT</strong> 파일을 여기에 드래그하거나<br />
          클릭하여 선택하세요
        </p>
        <span class="dropzone__button">파일 선택</span>
        <input
          ref="fileInputRef"
          type="file"
          accept=".pdf,.ppt,.pptx"
          class="sr-only"
          @change="onFileChange"
        />
      </div>

      <p v-if="workflow.uploadStatus === 'error'" class="upload-error">
        {{ workflow.uploadError }}
      </p>

      <div class="uploaded-doc" v-if="workflow.file">
        <h3 class="uploaded-doc__label">업로드된 문서</h3>

        <div class="doc-card">
          <span class="doc-card__icon">{{ workflow.file.ext.toUpperCase() }}</span>
          <div class="doc-card__info">
            <span class="doc-card__name">{{ workflow.file.name }}</span>
            <span class="doc-card__size">{{ fileSizeLabel }}</span>
          </div>
          <span
            v-if="workflow.uploadStatus === 'uploading'"
            class="doc-card__status doc-card__status--loading"
            aria-label="업로드 중"
          ></span>
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
          <ul class="extraction-meta" v-if="workflow.extraction">
            <li>· 추출: {{ workflow.extraction.mode }}</li>
            <li>· 페이지 {{ workflow.extraction.pages }} / Task {{ workflow.extraction.tasks }}건 인식</li>
          </ul>
        </Transition>

        <div class="upload-actions">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!canStartAnalysis"
            @click="startAnalysis"
          >
            <span v-if="workflow.analysisStatus === 'analyzing'">분석 진행 중…</span>
            <span v-else-if="workflow.analysisStatus === 'done'">분석 완료</span>
            <span v-else>분석 시작</span>
          </button>
          <button type="button" class="btn btn--text" @click="resetUpload">
            새 문서 업로드
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
