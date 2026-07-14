<script setup>
// A360 흐름도 액션 하나의 "박스"만 그린다 — 번호·라벨·패키지 색·신뢰도 뱃지·검수 위반 표시,
// 상세 모드면 파라미터 목록까지. 자식(본문) 렌더와 분기 컬럼 배치는 FlowSequence가 맡는다
// (트리 재귀·분기 그룹핑을 한 곳에 모으기 위함).
import { computed } from "vue";
import { confidenceBadge, formatParamValue } from "../utils/recommendation";

const props = defineProps({
  // { node, prefix, path } — numberFlowSteps/childItems가 만든 렌더 항목
  item: { type: Object, required: true },
  colorFor: { type: Function, required: true },
  // 현재 스텝의 위반 location 집합(Set<string>) 또는 null. 있으면 이 노드를 강조한다.
  violationPaths: { type: Object, default: null },
  // 상세 모드: 박스 아래에 파라미터 목록까지 (추천 흐름도 상세 패널). 모달 요약은 false.
  detailed: { type: Boolean, default: false },
  // 이 노드가 지금 국소 수정 중인 단계에 속하면 true — 박스 테두리를 붉게 강조·깜빡인다.
  editing: { type: Boolean, default: false },
});

const node = computed(() => props.item.node);
const isContainer = computed(() => (node.value.children?.length ?? 0) > 0);
const badge = computed(() => confidenceBadge(node.value.confidence));
const pkg = computed(() => node.value.package || "미지정");
const label = computed(() => node.value.label || node.value.action || "액션");
const parameters = computed(() => node.value.parameters ?? []);
const hasViolation = computed(() => !!props.violationPaths && props.violationPaths.has(props.item.path));
</script>

<template>
  <div class="flow-node">
    <div
      class="flow-box"
      :class="{ 'flow-box--violation': hasViolation, 'flow-box--container': isContainer, 'flow-box--editing': editing }"
    >
      <span class="flow-box__label">
        <span v-if="item.prefix" class="flow-node__num">{{ item.prefix }}</span>
        {{ label }}
        <span v-if="isContainer" class="flow-node__container-tag">컨테이너</span>
      </span>
      <span class="flow-box__meta">
        <span class="flow-box__tag" :style="{ background: colorFor(pkg) }">{{ pkg }}</span>
        <span
          v-if="badge"
          class="confidence-badge"
          :class="`confidence-badge--${badge.level}`"
        >
          {{ badge.text }}
        </span>
        <span v-if="hasViolation" class="flow-box__violation-mark" title="검수 위반">⚠</span>
      </span>
    </div>

    <!-- 상세 모드: 이 노드의 파라미터 목록 -->
    <ul v-if="detailed && parameters.length" class="flow-node__params rec-detail__params">
      <li v-for="p in parameters" :key="p.name">
        <span class="rec-detail__param-name">{{ p.name }}</span>
        <span class="rec-detail__param-value">{{ formatParamValue(p.value) }}</span>
      </li>
    </ul>
  </div>
</template>
