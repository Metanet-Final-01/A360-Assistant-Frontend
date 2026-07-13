<script setup>
import { computed, ref } from "vue";
import { usePipelineStore } from "../stores/pipeline";
import { buildPackageColorMap, confidenceBadge, flattenActions } from "../utils/recommendation";

const pipeline = usePipelineStore();

defineEmits(["close"]);

const packageColor = computed(() => buildPackageColorMap(pipeline.recommendation?.recommendation?.steps));

function colorFor(pkg) {
  return packageColor.value.get(pkg || "미지정") ?? "#888888";
}

// 업무 단계 구분 없이 모든 액션(중첩 포함)을 순서대로 박스 하나씩으로 펼친 단일 시퀀스.
const actionBoxes = computed(() => {
  const steps = pipeline.recommendation?.recommendation?.steps ?? [];
  let seq = 0;
  return steps.flatMap((stepRec) =>
    flattenActions(stepRec.actions).map((a) => ({ ...a, seq: (seq += 1), badge: confidenceBadge(a.confidence) })),
  );
});

// ----- 버전 이력 -----
// 순서변경·수정·삭제·추가는 분석 결과 패널의 업무 단계 카드에서 하므로, 여기는 읽기 전용 보기다.
const showHistory = ref(false);
const revertingVersion = ref(null);

pipeline.loadRecommendationHistory();

const SOURCE_LABEL = { llm: "자동 생성", drag: "직접 편집", chat: "챗 수정", feedback: "피드백" };

function versionDescription(v) {
  return v.change_summary || SOURCE_LABEL[v.source] || v.source || "";
}

// 백엔드에 개별 버전 조회 API가 없어, 이 브라우저 세션에서 트리를 캐시해 둔 버전만 되돌릴 수 있다.
function canRevert(v) {
  return v.version !== pipeline.recommendation?.version && !!pipeline.recommendTreesByVersion[v.version];
}

async function revertTo(version) {
  if (revertingVersion.value !== null) return;
  revertingVersion.value = version;
  await pipeline.revertToRecommendationVersion(version);
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
          <span v-if="pipeline.recommendation?.version" class="flow-version-badge">
            v{{ pipeline.recommendation.version }}
          </span>
        </h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow">
        <div class="flow-toolbar">
          <p class="flow-hint">전체 액션 시퀀스입니다. 패키지별 색상으로 구분됩니다.</p>
          <div class="flow-toolbar__actions">
            <button type="button" class="btn btn--outline" @click="showHistory = !showHistory">
              버전 이력
            </button>
          </div>
        </div>

        <p v-if="pipeline.recommendSaveError" class="upload-error">{{ pipeline.recommendSaveError }}</p>

        <div v-if="showHistory" class="flow-history">
          <h3 class="flow-history__title">버전 이력</h3>
          <p v-if="!pipeline.recommendVersions.length" class="flow-history__empty">
            저장된 버전이 없습니다.
          </p>
          <ol v-else class="flow-history__list">
            <li v-for="v in pipeline.recommendVersions" :key="v.id" class="flow-history__item">
              <div class="flow-history__meta">
                <strong>v{{ v.version }}</strong>
                <span v-if="v.version === pipeline.recommendation?.version" class="flow-history__current">
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
                <span class="flow-box__meta">
                  <span class="flow-box__tag" :style="{ background: colorFor(box.package) }">{{ box.package }}</span>
                  <span
                    v-if="box.badge"
                    class="confidence-badge"
                    :class="`confidence-badge--${box.badge.level}`"
                  >
                    {{ box.badge.text }}
                  </span>
                </span>
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

        <p v-if="pipeline.recommendation?.recommendation?.notes" class="flow-notes">
          <strong>참고:</strong> {{ pipeline.recommendation.recommendation.notes }}
        </p>
      </div>
    </div>
  </div>
</template>
