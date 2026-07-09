<script setup>
import { computed, ref } from "vue";
import {
  workflow,
  saveRecommendationEdit,
  revertToRecommendationVersion,
  loadRecommendationHistory,
} from "../store/workflow";
import FlowActionNode from "./FlowActionNode.vue";

defineEmits(["close"]);

// 패키지별 색상은 고정된 의미 매핑이 아니라, 이번 추천안에 등장한 패키지 순서대로 팔레트를 배정한다.
const PALETTE = ["#1f6f8b", "#7c5cbf", "#b7791f", "#1f9d55", "#d84a3a", "#2f6fa8", "#a8447a", "#55607a"];

const packageColor = computed(() => {
  const map = new Map();
  function walk(actions) {
    actions.forEach((a) => {
      const key = a.package || "미지정";
      if (!map.has(key)) map.set(key, PALETTE[map.size % PALETTE.length]);
      if (a.children?.length) walk(a.children);
    });
  }
  (workflow.recommendation?.recommendation?.steps ?? []).forEach((stepRec) => walk(stepRec.actions));
  return map;
});

function colorFor(pkg) {
  return packageColor.value.get(pkg || "미지정") ?? "#888888";
}

// 업무 단계 구분 없이 모든 액션(중첩 포함)을 순서대로 박스 하나씩으로 펼친 단일 시퀀스.
const actionBoxes = computed(() => {
  const steps = workflow.recommendation?.recommendation?.steps ?? [];
  const boxes = [];
  let seq = 0;
  function walk(actions) {
    actions.forEach((a) => {
      seq += 1;
      boxes.push({ seq, label: a.label || a.action, package: a.package || "미지정" });
      if (a.children?.length) walk(a.children);
    });
  }
  steps.forEach((stepRec) => walk(stepRec.actions ?? []));
  return boxes;
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ----- 편집 모드 -----
// 드래그·수정·삭제는 전부 로컬 복사본(editedTree)에서만 일어나고, "저장"을 눌렀을 때만
// 새 버전 1개가 만들어진다 — 백엔드가 호출마다 무조건 새 버전을 INSERT하기 때문에
// 미세 조작마다 저장하면 버전이 폭발한다.
const mode = ref("view"); // view | edit
const editedTree = ref(null);
const changeSummaries = ref([]); // FlowActionNode가 올려준 변경 종류 모음 → 저장 시 change_summary
const isSaving = ref(false);

const stepInfoById = computed(() => {
  const map = new Map();
  (workflow.analysis?.steps ?? []).forEach((s) => map.set(s.step_id, s));
  return map;
});

function enterEdit() {
  editedTree.value = clone(
    workflow.recommendation?.recommendation ?? { steps: [], variables: [], notes: null },
  );
  changeSummaries.value = [];
  mode.value = "edit";
}

function onTreeChanged(summary) {
  if (summary && !changeSummaries.value.includes(summary)) changeSummaries.value.push(summary);
}

function discardEdit() {
  editedTree.value = null;
  changeSummaries.value = [];
  mode.value = "view";
}

async function saveEdit() {
  if (isSaving.value) return;
  isSaving.value = true;
  await saveRecommendationEdit(
    clone(editedTree.value),
    changeSummaries.value.join(", ").slice(0, 500) || null,
  );
  isSaving.value = false;
  if (!workflow.recommendSaveError) discardEdit();
}

// ----- 버전 이력 -----
const showHistory = ref(false);
const revertingVersion = ref(null);

loadRecommendationHistory();

const SOURCE_LABEL = { llm: "자동 생성", drag: "직접 편집", chat: "챗 수정", feedback: "피드백" };

function versionDescription(v) {
  return v.change_summary || SOURCE_LABEL[v.source] || v.source || "";
}

// 백엔드에 개별 버전 조회 API가 없어, 이 브라우저 세션에서 트리를 캐시해 둔 버전만 되돌릴 수 있다.
function canRevert(v) {
  return v.version !== workflow.recommendation?.version && !!workflow.recommendTreesByVersion[v.version];
}

async function revertTo(version) {
  if (revertingVersion.value !== null) return;
  revertingVersion.value = version;
  await revertToRecommendationVersion(version);
  revertingVersion.value = null;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="rec-flow-modal-title">
      <header class="modal__header">
        <h2 id="rec-flow-modal-title">
          추천 작업 흐름도
          <span v-if="workflow.recommendation?.version" class="flow-version-badge">
            v{{ workflow.recommendation.version }}
          </span>
        </h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow">
        <!-- 보기 모드: 패키지 색상 다이어그램 -->
        <template v-if="mode === 'view'">
          <div class="flow-toolbar">
            <p class="flow-hint">전체 액션 시퀀스입니다. 패키지별 색상으로 구분됩니다.</p>
            <div class="flow-toolbar__actions">
              <button type="button" class="btn btn--outline" @click="showHistory = !showHistory">
                버전 이력
              </button>
              <button
                type="button"
                class="btn btn--primary"
                :disabled="!workflow.recommendation"
                @click="enterEdit"
              >
                편집
              </button>
            </div>
          </div>

          <p v-if="workflow.recommendSaveError" class="upload-error">{{ workflow.recommendSaveError }}</p>

          <div v-if="showHistory" class="flow-history">
            <h3 class="flow-history__title">버전 이력</h3>
            <p v-if="!workflow.recommendVersions.length" class="flow-history__empty">
              저장된 버전이 없습니다.
            </p>
            <ol v-else class="flow-history__list">
              <li v-for="v in workflow.recommendVersions" :key="v.id" class="flow-history__item">
                <div class="flow-history__meta">
                  <strong>v{{ v.version }}</strong>
                  <span v-if="v.version === workflow.recommendation?.version" class="flow-history__current">
                    현재
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
                  {{ revertingVersion === v.version ? "되돌리는 중…" : "이 버전으로 되돌리기" }}
                </button>
              </li>
            </ol>
            <p class="flow-history__hint">
              되돌리기는 삭제가 아니라 해당 버전 내용을 새 버전으로 다시 저장하는 방식입니다.
            </p>
          </div>

          <template v-if="actionBoxes.length">
            <div class="flow-diagram">
              <div class="flow-pill">시작</div>
              <div class="flow-arrow" aria-hidden="true"></div>

              <template v-for="(box, idx) in actionBoxes" :key="box.seq">
                <div class="flow-box">
                  <span class="flow-box__label">S{{ box.seq }}. {{ box.label }}</span>
                  <span class="flow-box__tag" :style="{ background: colorFor(box.package) }">{{ box.package }}</span>
                </div>
                <div v-if="idx < actionBoxes.length - 1" class="flow-arrow" aria-hidden="true"></div>
              </template>

              <div class="flow-arrow" aria-hidden="true"></div>
              <div class="flow-pill">완료</div>
            </div>

            <div class="flow-legend">
              <span v-for="[pkg, color] in packageColor" :key="pkg" class="flow-legend__item">
                <i class="flow-legend__swatch" :style="{ background: color }"></i>{{ pkg }}
              </span>
            </div>
          </template>
          <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>

          <p v-if="workflow.recommendation?.recommendation?.notes" class="flow-notes">
            <strong>참고:</strong> {{ workflow.recommendation.recommendation.notes }}
          </p>
        </template>

        <!-- 편집 모드: 중첩 액션 카드 트리 (로컬 편집 → 저장 시 1버전) -->
        <template v-else>
          <div class="flow-toolbar">
            <p class="flow-hint">
              액션 카드를 드래그해 순서를 바꾸고, 점 3개 메뉴에서 수정·삭제할 수 있습니다.
              변경 내용은 저장 버튼을 누를 때 한 번에 새 버전으로 저장됩니다.
            </p>
            <div class="flow-toolbar__actions">
              <button type="button" class="btn btn--outline" :disabled="isSaving" @click="discardEdit">
                취소
              </button>
              <button
                type="button"
                class="btn btn--primary"
                :disabled="isSaving || changeSummaries.length === 0"
                @click="saveEdit"
              >
                {{ isSaving ? "저장 중…" : "저장" }}
              </button>
            </div>
          </div>

          <p v-if="workflow.recommendSaveError" class="upload-error">{{ workflow.recommendSaveError }}</p>

          <template v-if="editedTree?.steps?.length">
            <section v-for="stepRec in editedTree.steps" :key="stepRec.step_id" class="flow-step-group">
              <h3 class="flow-step-group__title">
                {{ stepInfoById.get(stepRec.step_id)?.order ?? "?" }}.
                {{ stepInfoById.get(stepRec.step_id)?.name ?? stepRec.step_id }}
              </h3>
              <FlowActionNode :actions="stepRec.actions" :depth="0" @changed="onTreeChanged" />
            </section>
          </template>
          <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>

          <p v-if="editedTree?.notes" class="flow-notes"><strong>참고:</strong> {{ editedTree.notes }}</p>
        </template>
      </div>
    </div>
  </div>
</template>
