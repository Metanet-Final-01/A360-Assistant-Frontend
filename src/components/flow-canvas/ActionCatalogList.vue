<script setup>
// 카탈로그 API(GET /api/catalog/packages)를 검색·패키지별 접기/펼치기로 훑어보는 목록 — 사이드바
// 피커(ActionCatalogPanel, 캔버스 여백에 새 카드 추가)와 액션 교체 팝오버(ActionPickerPopover,
// 기존 액션의 패키지/액션을 다른 걸로 바꿔치기)가 이 컴포넌트 하나를 공유한다. 두 맥락의 유일한
// 차이는 "새로 추가"냐 "교체"냐일 뿐 목록 자체(검색·그룹핑·항목 모양)는 동일해서, 부모가 select
// 이벤트를 각자의 의미로 소비한다. draggable=false면(팝오버 맥락) 네이티브 드래그를 끈다 — 이미
// 존재하는 노드 위에 뜬 좁은 팝오버에서 드래그를 시작하면 밑에 깔린 흐름도 드래그 재정렬과
// 제스처가 충돌하기 쉽다.
//
// 두 맥락 모두 이 컴포넌트를 v-if로 마운트한다(사이드바는 편집모드 진입 시, 팝오버는 열 때) —
// 그래서 onMounted에서 로드하면 "피커를 열 때" 로드 요건이 자연히 충족된다. loadActionCatalog가
// 프라미스를 캐싱하므로 재마운트해도 실제 재요청은 최초 1회뿐이다.
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ACTION_CATALOG_MIME, loadActionCatalog, toActionDescriptor } from "../../utils/actionCatalog";

const { t } = useI18n();
const props = defineProps({
  draggable: { type: Boolean, default: true },
});
const emit = defineEmits(["select"]);

const query = ref("");
const collapsedGroups = ref(new Set());
const catalog = ref([]);
const loading = ref(true);
const loadFailed = ref(false);

async function load() {
  loading.value = true;
  loadFailed.value = false;
  try {
    catalog.value = await loadActionCatalog();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggleGroup(groupId) {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  collapsedGroups.value = next;
}

// 검색 중에는 어떤 그룹에 결과가 있는지 한눈에 보여야 하므로 접힘 상태를 무시하고 항상 펼친다.
function isExpanded(groupId) {
  if (query.value.trim()) return true;
  return !collapsedGroups.value.has(groupId);
}

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return catalog.value;
  return catalog.value.map((group) => {
    const groupMatches = group.name.toLowerCase().includes(q);
    const actions = groupMatches
      ? group.actions
      : group.actions.filter(
          (entry) => entry.label.toLowerCase().includes(q) || entry.action.toLowerCase().includes(q),
        );
    return actions.length ? { ...group, actions } : null;
  }).filter(Boolean);
});

function onDragStart(group, entry, event) {
  if (!props.draggable) return;
  const descriptor = toActionDescriptor(group, entry);
  event.dataTransfer.setData(ACTION_CATALOG_MIME, JSON.stringify(descriptor));
  event.dataTransfer.effectAllowed = "copy";
}

function onPick(group, entry) {
  emit("select", toActionDescriptor(group, entry));
}
</script>

<template>
  <div class="flow-catalog-list">
    <div class="flow-catalog-panel__search">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
        <path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <input
        v-model="query"
        type="text"
        :placeholder="t('actionCatalog.searchPlaceholder')"
        :aria-label="t('actionCatalog.searchPlaceholder')"
      />
    </div>

    <div class="flow-catalog-panel__list">
      <p v-if="loading" class="flow-catalog-panel__empty">{{ t("actionCatalog.loading") }}</p>
      <div v-else-if="loadFailed" class="flow-catalog-panel__empty">
        <p>{{ t("actionCatalog.loadError") }}</p>
        <button type="button" class="btn btn--outline btn--small" @click="load">
          {{ t("actionCatalog.retry") }}
        </button>
      </div>
      <p v-else-if="!filteredGroups.length" class="flow-catalog-panel__empty">{{ t("actionCatalog.noMatches") }}</p>

      <div v-for="group in filteredGroups" :key="group.id" class="flow-catalog-panel__group">
        <button
          type="button"
          class="flow-catalog-panel__group-header"
          :aria-expanded="isExpanded(group.id)"
          @click="toggleGroup(group.id)"
        >
          <span class="flow-catalog-panel__group-name">{{ group.name }}</span>
          <svg
            class="flow-catalog-panel__group-chevron"
            :class="{ 'flow-catalog-panel__group-chevron--open': isExpanded(group.id) }"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7 9.5 12 14l5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <ul v-if="isExpanded(group.id)" class="flow-catalog-panel__actions">
          <li v-for="entry in group.actions" :key="entry.id">
            <button
              type="button"
              class="flow-catalog-panel__action"
              :draggable="draggable"
              :title="draggable ? t('actionCatalog.dragHint') : ''"
              @dragstart="onDragStart(group, entry, $event)"
              @click="onPick(group, entry)"
            >
              <span class="flow-catalog-panel__action-label">{{ entry.label }}</span>
              <span v-if="entry.isContainer" class="flow-catalog-panel__action-badge">
                {{ t("actionCatalog.containerBadge") }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
