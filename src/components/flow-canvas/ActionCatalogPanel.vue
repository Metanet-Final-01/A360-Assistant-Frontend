<script setup>
// 흐름도 편집 캔버스 좌측에 붙는 "패키지/액션" 피커 — ActionCatalogList(검색·그룹핑·항목)를
// 사이드바 크롬으로 감싼다. 항목을 클릭하면 캔버스 여백에 미배치 카드로 놓이고(insert 이벤트,
// FlowCanvas.addUnplacedAction이 소비), 항목을 드래그하면 FlowCanvas가 네이티브 HTML5 DnD
// (ACTION_CATALOG_MIME)로 받아 드롭 위치에 끼워 넣는다.
import { useI18n } from "vue-i18n";
import ActionCatalogList from "./ActionCatalogList.vue";

const { t } = useI18n();
const emit = defineEmits(["insert"]);
</script>

<template>
  <aside class="flow-catalog-panel">
    <div class="flow-catalog-panel__header">
      <h3 class="flow-catalog-panel__title">{{ t("actionCatalog.title") }}</h3>
      <p class="flow-catalog-panel__hint">{{ t("actionCatalog.hint") }}</p>
    </div>
    <ActionCatalogList draggable @select="emit('insert', $event)" />
  </aside>
</template>
