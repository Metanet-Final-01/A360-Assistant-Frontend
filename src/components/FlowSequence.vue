<script setup>
// 형제 액션 목록을 렌더한다 — 여기서 "분기"와 "중첩"을 가른다:
//  · 연속한 분기 노드(Try/Catch/Finally, If/Else) 2개 이상 → 각각 "다른 열"(컬럼)로.
//  · 분기 그룹이 1개거나 Loop/Step 같은 단일 컨테이너 → 들여쓰기 중첩(레일).
//  · 그 외 일반 액션 → 세로 박스.
// 자식 본문은 자기 자신(FlowSequence)을 재귀 호출해 그린다 — 컬럼 안에 또 분기가 있으면
// 그 안에서 다시 컬럼이 된다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import FlowNode from "./FlowNode.vue";
import { isBranchNode, isBranchStarter, childItems, branchColumnExits, branchRole } from "../utils/recommendation";

defineOptions({ name: "FlowSequence" });

const props = defineProps({
  // [{ node, prefix, path }] — numberFlowSteps / childItems 산출
  items: { type: Array, default: () => [] },
  colorFor: { type: Function, required: true },
  violationPaths: { type: Object, default: null },
  detailed: { type: Boolean, default: false }, // 파라미터까지 (상세 패널)
  arrows: { type: Boolean, default: false }, // 세그먼트 사이 화살표 (다이어그램 모달)
  editing: { type: Boolean, default: false }, // 이 단계가 국소 수정 중 → 모든 노드 강조·깜빡
});

// 분기 컬럼이 좁아서 가로로 넘칠 때 — 기본 스크롤바(특히 오버레이 스타일)만으로는 스크롤
// 가능하다는 게 잘 안 보이므로, 좌우 끝에 "더 있다" 페이드를 얹는다. 컬럼들 자체가 불투명한
// 카드라 배경 그라디언트만으로는 안 가려져서(항상 카드 밑에 깔림), 별도 오버레이 요소를
// 스크롤 상태에 따라 보이고/숨긴다. 패널을 리사이즈해 넘침 여부가 바뀔 수도 있어
// ResizeObserver로도 다시 계산한다.
const branchRefs = ref([]);
let resizeObserver = null;

function updateColsFade(colsEl) {
  const wrap = colsEl?.parentElement;
  if (!wrap) return;
  const canLeft = colsEl.scrollLeft > 1;
  const canRight = colsEl.scrollLeft < colsEl.scrollWidth - colsEl.clientWidth - 1;
  wrap.classList.toggle("flow-branch__cols-wrap--can-left", canLeft);
  wrap.classList.toggle("flow-branch__cols-wrap--can-right", canRight);
}

function onColsScroll(event) {
  updateColsFade(event.target);
}

function colsElOf(branchEl) {
  return branchEl?.querySelector(".flow-branch__cols") ?? null;
}

// 마운트 시점에 있던 분기 컬럼만 이 초기화를 거치면, 이후 데이터 변경(라이브 스트리밍·편집)으로
// 새로 나타난 분기 컬럼은 초기 페이드 상태도 못 잡고 ResizeObserver에도 안 걸린다 — segments가
// 바뀔 때마다 다시 불러야 한다.
function setupBranchFades() {
  branchRefs.value.forEach((branchEl) => {
    const colsEl = colsElOf(branchEl);
    if (!colsEl) return;
    updateColsFade(colsEl);
    resizeObserver?.observe(colsEl);
  });
}

onMounted(async () => {
  await nextTick();
  resizeObserver = new ResizeObserver(() => {
    branchRefs.value.forEach((branchEl) => updateColsFade(colsElOf(branchEl)));
  });
  setupBranchFades();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

const segments = computed(() => {
  const raw = [];
  let cur = null; // 진행 중인 분기 그룹
  for (const item of props.items) {
    if (isBranchNode(item.node)) {
      const starter = isBranchStarter(item.node); // Try는 새 그룹 시작
      if (cur && cur.pkg === item.node.package && !starter) {
        cur.items.push(item); // Catch/Finally/Else — 앞 분기의 다른 열
      } else {
        if (cur) raw.push(cur);
        cur = { type: "branch", pkg: item.node.package, items: [item] };
      }
    } else {
      if (cur) {
        raw.push(cur);
        cur = null;
      }
      raw.push({ type: "node", item });
    }
  }
  if (cur) raw.push(cur);
  // 분기(Error handler·If)는 항상 '감싸는 블록(컬럼)'으로 렌더한다 — 단독 Try/If여도 들여쓰기가 아니라
  // 블록 안에 본문을 넣는다. (Loop/Step 같은 단일 컨테이너는 애초에 분기 그룹이 아니라 node로 중첩됨)
  return raw.map((s) => ({ ...s, key: s.type === "branch" ? s.items[0].path : s.item.path }));
});

// segments가 바뀌면(props.items 변경) 새로 렌더된 분기 컬럼에 대해 페이드 초기화를 다시 돈다.
watch(segments, async () => {
  await nextTick();
  setupBranchFades();
});

function kids(item) {
  return childItems(item.prefix, item.path, item.node.children);
}
function hasChildren(node) {
  return (node.children?.length ?? 0) > 0;
}
// 이 분기 컬럼이 다음/완료로 이어지는지 (A360: Try/Catch는 Finally로 합류, Finally·If·Else만 진행).
function columnExits(seg, col) {
  return branchColumnExits(seg.pkg, col.node, seg.items);
}
// 역할 뱃지 색 구분 클래스 — Try/Catch/Finally/Throw·If/Else를 한눈에.
function roleClass(role) {
  const key = { Try: "try", Catch: "catch", Finally: "finally", Throw: "throw" }[role];
  return key ? `flow-branch__role--${key}` : "flow-branch__role--cond";
}
// 분기 블록 라벨 — 패키지별로 사람이 읽는 이름(단독 Try여도 '분기'가 아니라 '예외 처리').
function branchLabel(pkg) {
  if (pkg === "Error handler") return "예외 처리";
  if (pkg === "If") return "조건 분기";
  return `분기 · ${pkg}`;
}

// 다이어그램(arrows) 모드 커넥터용 기하: 각 컬럼의 중심 x(%)와 출구 여부. 컬럼은 등폭(flex 1 1 0)
// 이라 인덱스로 중심을 계산한다(열 몇 개·넓은 모달에서 오차 <1%). exit 컬럼만 아래로 내려가 병합.
function convCols(seg) {
  const n = seg.items.length;
  return seg.items.map((col, i) => ({
    path: col.path,
    x: `${(((i + 0.5) / n) * 100).toFixed(2)}%`,
    exit: columnExits(seg, col),
  }));
}
// 병합 바: 출구 컬럼들의 중심과 그룹 중앙(50%)을 잇는 가로선 범위. 출구가 Finally 하나뿐이면
// Finally 중심 ↔ 중앙으로 이어져 완료 노드(중앙 정렬)와 정렬된다.
function mergeBar(seg) {
  const n = seg.items.length;
  const xs = seg.items
    .map((col, i) => ({ x: ((i + 0.5) / n) * 100, exit: columnExits(seg, col) }))
    .filter((c) => c.exit)
    .map((c) => c.x);
  const lo = Math.min(50, ...xs);
  const hi = Math.max(50, ...xs);
  return { left: `${lo.toFixed(2)}%`, width: `${(hi - lo).toFixed(2)}%` };
}
</script>

<template>
  <template v-for="(seg, si) in segments" :key="seg.key">
    <!-- 일반 노드 / 단일 컨테이너 -->
    <template v-if="seg.type === 'node'">
      <FlowNode
        :item="seg.item"
        :color-for="colorFor"
        :violation-paths="violationPaths"
        :detailed="detailed"
        :editing="editing"
      />
      <!-- 컨테이너 본문(Loop/Step/단일 If 등): 들여쓴 레일 안에 재귀 -->
      <div v-if="hasChildren(seg.item.node)" class="flow-node__children">
        <FlowSequence
          :items="kids(seg.item)"
          :color-for="colorFor"
          :violation-paths="violationPaths"
          :detailed="detailed"
          :arrows="arrows"
          :editing="editing"
        />
      </div>
    </template>

    <!-- 분기 그룹(2개 이상) → 각각 다른 열 -->
    <div v-else class="flow-branch" ref="branchRefs">
      <div class="flow-branch__label">{{ branchLabel(seg.pkg) }}</div>
      <div class="flow-branch__cols-wrap">
      <div class="flow-branch__cols" @scroll="onColsScroll">
        <div v-for="col in seg.items" :key="col.path" class="flow-branch__col">
          <!-- 컨테이너 역할 뱃지: 이 컬럼이 Try/Catch/Finally(또는 If/Else) 중 무엇인지 명시 -->
          <span
            v-if="branchRole(col.node)"
            class="flow-branch__role"
            :class="roleClass(branchRole(col.node))"
          >
            {{ branchRole(col.node) }}
          </span>
          <FlowNode
            :item="col"
            :color-for="colorFor"
            :violation-paths="violationPaths"
            :detailed="detailed"
            :editing="editing"
          />
          <div v-if="hasChildren(col.node)" class="flow-branch__body">
            <FlowSequence
              :items="kids(col)"
              :color-for="colorFor"
              :violation-paths="violationPaths"
              :detailed="detailed"
              :arrows="arrows"
              :editing="editing"
            />
          </div>
          <p v-else class="flow-branch__empty">(본문 없음)</p>
          <!-- 상세 패널(비다이어그램): 컬럼 하단에 진행(↓ 화살표)/종료(✕, Finally로 합류) 그래픽 -->
          <div
            v-if="!arrows"
            class="flow-branch__drop"
            :class="columnExits(seg, col) ? 'flow-branch__drop--go' : 'flow-branch__drop--stop'"
            :title="columnExits(seg, col)
              ? '다음 단계(또는 완료)로 이어짐'
              : '여기서 끝나지 않고 Finally로 합류한 뒤 진행됨'"
          ></div>
        </div>
      </div>
      <div class="flow-branch__cols-fade flow-branch__cols-fade--left" aria-hidden="true"></div>
      <div class="flow-branch__cols-fade flow-branch__cols-fade--right" aria-hidden="true"></div>
      </div>
      <!-- 다이어그램(arrows): 실제 커넥터 — 출구 컬럼(Finally·If·Else)만 아래로 내려가 중앙에서
           병합해 완료/다음으로 이어지고, Try/Catch는 ✕로 종료(Finally로 합류)한다. -->
      <div v-if="arrows" class="flow-branch__conv" aria-hidden="true">
        <template v-for="c in convCols(seg)" :key="c.path">
          <span v-if="c.exit" class="flow-branch__conv-drop" :style="{ left: c.x }"></span>
          <span v-else class="flow-branch__conv-cap" :style="{ left: c.x }">✕</span>
        </template>
        <span class="flow-branch__conv-bar" :style="mergeBar(seg)"></span>
        <span class="flow-branch__conv-stub"></span>
      </div>
    </div>

    <!-- 세그먼트 사이 화살표 (다이어그램 모드에서만) -->
    <div v-if="arrows && si < segments.length - 1" class="flow-arrow" aria-hidden="true"></div>
  </template>
</template>
