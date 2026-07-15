<script setup>
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePipelineStore } from "../stores/pipeline";
import { downloadRecommendationExport } from "../api/recommend";
import { buildPackageColorMap, numberFlowSteps, violationSetByStep } from "../utils/recommendation";
import FlowSequence from "./FlowSequence.vue";

// "흐름도 보기" 버튼을 눌러야만 열리는 요약 다이어그램 모달 — 실제로 열 때만 내려받는다.
const RecommendationFlowModal = defineAsyncComponent(() => import("./RecommendationFlowModal.vue"));

// 루트 노드가 여러 개(패널 + 모달)라 attrs 자동 전달이 안 되므로,
// 패널 재배치용 data-panel-key/order 스타일을 패널 섹션에 직접 물려준다.
defineOptions({ inheritAttrs: false });

const pipeline = usePipelineStore();
const { t } = useI18n();

const showFlowModal = ref(false);
// 패널 루트 — 국소 수정 중인 단계로 스크롤할 때 그 단계 요소를 여기서 찾는다.
const rootRef = ref(null);

// 업무 단계(WorkStep, schemas/analysis.py) 확인·편집은 업로드 패널로 옮겨졌다 — 여기는
// 흐름도(RecommendedAction, schemas/recommendation.py)만 다룬다. 흐름도 step은 분석 단계와
// 1:1이 아니므로(에이전트가 자유롭게 합치고 쪼갠다), step_id로 분석 결과와 매칭하지 않고
// 흐름도 데이터만으로 독립적으로 렌더한다.
const hasSteps = computed(() => (pipeline.analysis?.steps ?? []).length > 0);
// "흐름도 보기"/"JSON 다운로드" 버튼을 보여줄지: 분석이 단계를 찾아 새로 생성할 수 있거나(hasSteps),
// 텍스트 업로드처럼 분석이 단계를 못 찾았어도 챗봇 대화(예: "분석해서 흐름도까지 만들어줘")로 이미
// 흐름도가 만들어져 있으면(pipeline.recommendation) 보여준다 — 이 경우 analysisStatus/hasSteps만으로는
// 판단할 수 없다.
const canShowRecommendFooter = computed(
  () => (pipeline.analysisStatus === "done" && hasSteps.value) || !!pipeline.recommendation,
);

// 스트리밍 중이면 라이브 스냅샷(liveFlow)을, 아니면 저장된 최종 추천안을 소스로 삼는다 —
// 이 패널이 흐름도 생성/수정 과정을 실시간으로, 완료 후 최종본을 "같은 자리"에서 보여준다.
// (모달 팝업 대신 인라인 스트리밍) 흐름도 step은 분석(WorkStep)과 1:1이 아니라 흐름도
// 데이터(steps→actions→children)만으로 독립 렌더한다.
const liveMode = computed(() => pipeline.liveActive);
const activeRec = computed(() =>
  liveMode.value ? pipeline.liveFlow : pipeline.recommendation?.recommendation,
);
const activeSteps = computed(() => activeRec.value?.steps ?? []);
const hasActions = computed(() => activeSteps.value.some((s) => (s.actions?.length ?? 0) > 0));

// 분석/생성/스트리밍 중이면 "작업 중" — 아직 그릴 액션이 없어도 빈 화면 대신 스피너를 보여준다.
const working = computed(
  () => liveMode.value || pipeline.analysisStatus === "analyzing" || pipeline.recommendStatus === "generating",
);
const workingText = computed(() =>
  pipeline.analysisStatus === "analyzing" ? "업무를 분석하는 중…" : "흐름도를 구성하는 중… 에이전트가 액션을 탐색하고 있습니다.",
);

const packageColor = computed(() => buildPackageColorMap(activeSteps.value));
function colorFor(pkg) {
  return packageColor.value.get(pkg || t("common.unspecified")) ?? "#888888";
}

const recVariables = computed(() => activeRec.value?.variables ?? []);
const inputVars = computed(() => recVariables.value.filter((v) => v.direction === "input"));
const outputVars = computed(() => recVariables.value.filter((v) => v.direction === "output"));
const notes = computed(() => activeRec.value?.notes);

// 트리 렌더용 정규화(모달과 동일한 번호·경로 헬퍼) + 스트리밍 중 검수 위반 노드 강조.
const numberedSteps = computed(() => numberFlowSteps(activeSteps.value));
const violationsByStep = computed(() =>
  liveMode.value ? violationSetByStep(pipeline.liveViolations) : new Map(),
);
function stepViolations(stepId) {
  return violationsByStep.value.get(stepId) ?? null;
}
const liveViolationCount = computed(() => pipeline.liveViolations?.length ?? 0);

// 지금 국소 수정 중인 단계(step_id) — 그 단계의 액션 박스를 붉게 강조·깜빡이고 그 위치로
// 스크롤한다. 라이브 스트림 중에만 의미가 있다(최종본에선 null).
const activeStep = computed(() => (liveMode.value ? pipeline.liveActiveStep : null));

// 수정 중인 단계가 바뀌면 그 단계로 부드럽게 스크롤한다 — 사용자가 "지금 어디를 고치는지"
// 눈으로 따라가게. 프레임 반영(트리 재렌더) 후 DOM이 갱신되도록 nextTick을 기다린다.
watch(activeStep, async (stepId) => {
  if (!stepId) return;
  await nextTick();
  rootRef.value
    ?.querySelector(`[data-step-id="${stepId}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// "흐름도 보기" 버튼: 이미 있으면 요약 다이어그램 모달을 열고, 없으면 생성한다 —
// 생성 과정은 이 패널이 인라인으로 실시간 렌더하므로 별도 로딩 모달을 띄우지 않는다.
async function openFlowView() {
  if (pipeline.recommendStatus === "done") {
    showFlowModal.value = true;
    return;
  }
  await pipeline.startRecommend();
}

// 내보내기는 프론트 로컬 Blob이 아니라 백엔드 표준 export API 응답을 그대로 저장한다
// (P1-3 — schema_version 포함 봉투, 골든셋 채점 포맷과 일치). 추천안 버전이 있어야 가능.
const exportError = ref("");
const canExport = computed(() => !!pipeline.sessionId && pipeline.recommendation?.version != null);

async function downloadJson() {
  if (!canExport.value) return;
  exportError.value = "";
  try {
    await downloadRecommendationExport(pipeline.sessionId, pipeline.recommendation.version);
  } catch (err) {
    exportError.value = err?.message ?? t("recommendDetail.errors.exportFailed");
  }
}

// ── v3 품질 루프 진행 카드 (spec/candidates/verdict/scorecard 프레임) ──
// v2 백엔드에선 이 값들이 항상 null이라 스트립 자체가 렌더되지 않는다(하위호환).
const liveCandidates = computed(() => pipeline.liveCandidates);
const liveVerdict = computed(() => pipeline.liveVerdict);
const liveScorecard = computed(() => pipeline.liveScorecard);
const candStatusText = { composing: "설계 중…", verifying: "검증 중…", failed: "실패" };

// ── 질문 카드(needs_input, v3) — 미해소 카드만 보여주고 응답을 fill_cards 턴으로 보낸다 ──
const flowConfidence = computed(() => activeRec.value?.flow_confidence ?? null);
const questionCards = computed(() => (activeRec.value?.needs_input ?? []).filter((c) => !c.resolved));
const cardAnswers = ref({});
const canSubmitCards = computed(
  () =>
    !liveMode.value &&
    pipeline.fillCardsStatus !== "sending" &&
    Object.values(cardAnswers.value).some((v) => v !== "" && v != null && v !== false),
);

async function submitCards() {
  const values = {};
  for (const c of questionCards.value) {
    const v = cardAnswers.value[c.card_id];
    if (v === "" || v == null || v === false) continue; // 미응답 카드는 보내지 않는다(부분 응답 허용)
    values[c.card_id] = c.input_type === "number" ? Number(v) : v;
  }
  if (!Object.keys(values).length) return;
  await pipeline.fillCards(values);
  cardAnswers.value = {};
}
</script>

<template>
  <section
    ref="rootRef"
    class="panel panel--wide"
    aria-labelledby="analysis-panel-title"
    data-tour="recommend"
    v-bind="$attrs"
  >
    <header class="panel__header">
      <span
        class="panel-drag-handle"
        draggable="true"
        data-panel-handle
        :title="t('common.dragHandle')"
        aria-hidden="true"
        >⠿</span
      >
      <h2 id="analysis-panel-title">{{ t("recommendDetail.title") }}</h2>
    </header>

    <div class="panel__body">
      <!-- 실시간 생성/수정 상태 배너 — 스트림 프레임마다 캡션·위반 수가 갱신된다 -->
      <div v-if="liveMode" class="flow-live-status">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <span class="flow-live-status__caption">{{ pipeline.liveCaption || "흐름도 구성 중…" }}</span>
        <span v-if="liveViolationCount" class="flow-live-status__violations">
          검수 위반 {{ liveViolationCount }}건
        </span>
      </div>

      <!-- v3 품질 루프 진행 스트립 — 후보 카드(트리는 승자 확정 후에만) · 심판 · 검증 요약 -->
      <div v-if="liveMode && (liveCandidates || liveVerdict || liveScorecard)" class="flow-quality-strip">
        <div v-if="liveCandidates" class="flow-quality-strip__cands">
          <span
            v-for="c in liveCandidates"
            :key="c.id"
            class="quality-cand"
            :class="`quality-cand--${c.status}`"
          >
            <strong>{{ c.persona }}</strong>
            <em>{{ candStatusText[c.status] ?? `단계 ${c.steps} · 액션 ${c.actions}` }}</em>
          </span>
        </div>
        <p v-if="liveVerdict" class="quality-verdict">
          🏆 후보 {{ liveVerdict.winner }} 선택 — {{ liveVerdict.reason }}
        </p>
        <p v-if="liveScorecard" class="quality-scorecard">
          must 커버리지
          {{ liveScorecard.must_coverage != null ? Math.round(liveScorecard.must_coverage * 100) + "%" : "—" }}
          · blocker {{ liveScorecard.blockers ?? 0 }}건
          · 질문 카드 {{ liveScorecard.cards ?? 0 }}장
          <template v-if="liveScorecard.flow_confidence != null">
            · 흐름도 신뢰도 {{ Math.round(liveScorecard.flow_confidence * 100) }}%
          </template>
        </p>
      </div>

      <!-- 과거 세션 로딩 중 -->
      <div v-if="pipeline.sessionLoadStatus === 'loading'" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ t("recommendDetail.sessionLoadingHint") }}</p>
      </div>

      <!-- 아직 아무 것도 없고 작업도 안 함 -->
      <div v-else-if="!hasActions && !working" class="empty-state">

        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <p>{{ t("recommendDetail.emptyState") }}</p>
      </div>

      <!-- 작업 중인데 아직 그릴 액션 프레임 전 (분석 중 / 생성 준비 중) -->
      <div v-else-if="!hasActions && working" class="analyzing-state">
        <span class="analyzing-state__spinner" aria-hidden="true"></span>
        <p>{{ workingText }}</p>
      </div>

      <!-- 흐름도 상세: 라이브/최종 공통. 중첩(컨테이너=분기) 트리 + 파라미터를 인라인 렌더 -->
      <div v-else class="rec-detail">
        <div v-if="inputVars.length || outputVars.length" class="rec-detail__vars">
          <div v-if="inputVars.length" class="rec-detail__var-group">
            <h4>{{ t("recommendDetail.inputVars") }}</h4>
            <ul>
              <li v-for="v in inputVars" :key="v.name">
                <strong>{{ v.name }}</strong>
                <span class="rec-detail__var-type">{{ v.type }}</span>
                <span v-if="v.description"> — {{ v.description }}</span>
              </li>
            </ul>
          </div>
          <div v-if="outputVars.length" class="rec-detail__var-group">
            <h4>{{ t("recommendDetail.outputVars") }}</h4>
            <ul>
              <li v-for="v in outputVars" :key="v.name">
                <strong>{{ v.name }}</strong>
                <span class="rec-detail__var-type">{{ v.type }}</span>
                <span v-if="v.description"> — {{ v.description }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div
          v-for="step in numberedSteps"
          :key="step.key"
          class="rec-detail__step"
          :class="{ 'rec-detail__step--editing': step.step_id === activeStep }"
          :data-step-id="step.step_id"
        >
          <h4 class="rec-detail__step-title">{{ step.title }}</h4>
          <p v-if="step.description" class="rec-detail__step-desc">{{ step.description }}</p>

          <FlowSequence
            v-if="step.items.length"
            :items="step.items"
            :color-for="colorFor"
            :violation-paths="stepViolations(step.step_id)"
            :editing="step.step_id === activeStep"
            detailed
          />
          <p v-else class="flow-step-empty">이 단계는 확정된 액션이 없습니다</p>
        </div>

        <p v-if="notes" class="flow-notes"><strong>{{ t("common.notesLabel") }}</strong> {{ notes }}</p>

        <!-- 질문 카드(v3) — 흐름도는 완성 상태이고, 카드는 시안값 확인/빈칸 채움 요청이다 -->
        <div v-if="!liveMode && questionCards.length" class="question-cards">
          <h4 class="question-cards__title">
            확인이 필요한 항목 <span class="question-cards__count">{{ questionCards.length }}</span>
          </h4>
          <div
            v-for="card in questionCards"
            :key="card.card_id"
            class="question-card"
            :class="{ 'question-card--blocking': card.blocking }"
          >
            <p class="question-card__q">
              {{ card.question }}
              <span v-if="card.blocking" class="question-card__badge">필수</span>
            </p>
            <p v-if="card.why" class="question-card__why">{{ card.why }}</p>
            <select
              v-if="card.input_type === 'select'"
              v-model="cardAnswers[card.card_id]"
              class="question-card__input"
            >
              <option value="" disabled>선택…</option>
              <option v-for="opt in card.options || []" :key="String(opt)" :value="opt">{{ opt }}</option>
            </select>
            <label v-else-if="card.input_type === 'confirm'" class="question-card__confirm">
              <input v-model="cardAnswers[card.card_id]" type="checkbox" />
              이 전제대로 진행합니다
            </label>
            <input
              v-else
              v-model="cardAnswers[card.card_id]"
              :type="card.input_type === 'number' ? 'number' : 'text'"
              class="question-card__input"
              :placeholder="card.default != null ? `시안값: ${card.default}` : '값을 입력하세요…'"
            />
          </div>
          <button
            type="button"
            class="btn btn--primary question-cards__submit"
            :disabled="!canSubmitCards"
            @click="submitCards"
          >
            {{ pipeline.fillCardsStatus === "sending" ? "반영 중…" : "응답 반영" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="canShowRecommendFooter" class="panel__footer">
      <div class="recommend-section">
        <h3 class="export-section__title">{{ t("recommendDetail.recommendSectionTitle") }}</h3>

        <div class="recommend-section__actions">
          <span v-if="pipeline.recommendation" class="recommend-section__version">
            v{{ pipeline.recommendation.version }}
          </span>
          <span
            v-if="flowConfidence != null"
            class="flow-confidence"
            :class="flowConfidence >= 0.7 ? 'flow-confidence--high' : flowConfidence >= 0.4 ? 'flow-confidence--mid' : 'flow-confidence--low'"
            title="흐름도 수준 신뢰도 — 요구 커버리지 × 검증 결과 × 시뮬레이션 (v3)"
          >
            신뢰도 {{ Math.round(flowConfidence * 100) }}%
          </span>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="pipeline.recommendStatus === 'generating' || liveMode"
            @click="openFlowView"
          >
            {{ pipeline.recommendStatus === "generating" || liveMode ? t("recommendDetail.generating") : t("recommendDetail.viewFlow") }}
          </button>
        </div>
        <p v-if="pipeline.recommendStatus === 'error'" class="upload-error recommend-section__save-error">
          {{ pipeline.recommendError }}
        </p>
        <p v-if="pipeline.recommendSaveError" class="upload-error recommend-section__save-error">
          {{ pipeline.recommendSaveError }}
        </p>
      </div>

      <div class="export-section">
        <h3 class="export-section__title">{{ t("recommendDetail.exportTitle") }}</h3>
        <div class="export-section__actions">
          <button
            type="button"
            class="btn btn--outline"
            :disabled="!canExport"
            :title="canExport ? '' : t('recommendDetail.exportDisabledHint')"
            @click="downloadJson"
          >
            {{ t("recommendDetail.exportJson") }}
          </button>
        </div>
        <p v-if="exportError" class="upload-error recommend-section__save-error">{{ exportError }}</p>
      </div>
    </div>
  </section>

  <RecommendationFlowModal v-if="showFlowModal" @close="showFlowModal = false" />
</template>
