import { defineStore } from "pinia";
import { ref } from "vue";
import { listSessions, deleteSession } from "../api/sessions";
import { ApiError } from "../api/http";
import { formatDateLabel } from "../utils/dateFormat";
import { t } from "../i18n";

// 세션 이력(사이드바 서브메뉴) 목록 스토어. 세션을 선택했을 때의 상세 데이터(분석·추천·대화)는
// 더 이상 여기서 들고 있지 않다 — pipeline.js의 loadSession()이 그 세션을 "현재 세션"으로
// 하이드레이션하는 방식으로 흡수됐다(RPA-100 아카이브·분석 메뉴 통합).

export const useArchiveStore = defineStore("archive", () => {
  const sessions = ref([]); // [{ id, title, solution, created_at, updated_at, dateLabel }]
  const listStatus = ref("idle"); // idle | loading | done | error
  const listError = ref("");
  const deleteError = ref(""); // 목록 로드와 별개 — listStatus를 바꾸면 목록 자체가 화면에서 사라진다

  async function loadSessions() {
    listStatus.value = "loading";
    listError.value = "";
    try {
      const { sessions: rows } = await listSessions();
      sessions.value = rows.map((s) => ({ ...s, dateLabel: formatDateLabel(s.updated_at ?? s.created_at) }));
      listStatus.value = "done";
    } catch (err) {
      listStatus.value = "error";
      listError.value = err instanceof ApiError ? err.message : t("archive.errors.loadFailed");
      sessions.value = [];
    }
  }

  async function removeSession(id) {
    deleteError.value = "";
    try {
      await deleteSession(id);
    } catch (err) {
      deleteError.value = err instanceof ApiError ? err.message : t("archive.errors.deleteFailed");
      return false;
    }
    sessions.value = sessions.value.filter((s) => s.id !== id);
    return true;
  }

  function resetForLogout() {
    sessions.value = [];
    listStatus.value = "idle";
    listError.value = "";
    deleteError.value = "";
  }

  return {
    sessions,
    listStatus,
    listError,
    deleteError,
    loadSessions,
    removeSession,
    resetForLogout,
  };
});
