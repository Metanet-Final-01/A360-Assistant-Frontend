<script setup>
defineProps({
  steps: {
    type: Array,
    required: true,
  },
});
defineEmits(["close"]);

function confidenceClass(confidence) {
  if (confidence >= 0.9) return "confidence-badge--high";
  if (confidence >= 0.8) return "confidence-badge--mid";
  return "confidence-badge--low";
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal--flow" role="dialog" aria-modal="true" aria-labelledby="flow-modal-title">
      <header class="modal__header">
        <h2 id="flow-modal-title">업무 흐름도</h2>
        <button type="button" class="modal__close" aria-label="닫기" @click="$emit('close')">✕</button>
      </header>

      <div class="modal__body modal__body--flow">
        <p class="flow-hint">저장된 분석 결과의 업무 흐름입니다.</p>

        <template v-if="steps.length">
          <div class="flow-diagram">
            <div class="flow-pill">시작</div>
            <div class="flow-arrow" aria-hidden="true"></div>

            <ol class="flow-list">
              <li v-for="(step, idx) in steps" :key="step.id" class="flow-card">
                <div class="flow-card__row">
                  <div class="flow-card__content">
                    <header class="flow-card__header">
                      <h3>{{ step.stepNo }}. {{ step.title }}</h3>
                    </header>
                    <p class="flow-card__action">{{ step.action }}</p>
                    <dl class="flow-card__meta">
                      <div>
                        <dt>필요 패키지</dt>
                        <dd>{{ step.package }}</dd>
                      </div>
                      <div>
                        <dt>입력 변수</dt>
                        <dd>{{ step.inputVar }}</dd>
                      </div>
                      <div>
                        <dt>출력 변수</dt>
                        <dd>{{ step.outputVar }}</dd>
                      </div>
                    </dl>
                    <p class="flow-card__evidence">근거 : {{ step.evidence }}</p>
                  </div>

                  <div class="flow-card__top-right">
                    <span
                      v-if="typeof step.confidence === 'number'"
                      class="confidence-badge"
                      :class="confidenceClass(step.confidence)"
                    >
                      신뢰도 {{ step.confidence.toFixed(2) }}
                    </span>
                  </div>
                </div>

                <div v-if="idx < steps.length - 1" class="flow-card__connector" aria-hidden="true"></div>
              </li>
            </ol>

            <div class="flow-arrow" aria-hidden="true"></div>
            <div class="flow-pill">완료</div>
          </div>
        </template>

        <p v-else class="modal__empty">표시할 추천 결과가 없습니다.</p>
      </div>
    </div>
  </div>
</template>
