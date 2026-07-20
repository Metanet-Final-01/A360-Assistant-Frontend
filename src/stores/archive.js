import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { listSessions, deleteSession } from "../api/sessions";
import { ApiError } from "../api/http";
import { formatDateLabel } from "../utils/dateFormat";
import { t } from "../i18n";

// 세션 이력(사이드바 서브메뉴) 목록 스토어. 세션을 선택했을 때의 상세 데이터(분석·추천·대화)는
// 더 이상 여기서 들고 있지 않다 — pipeline.js의 loadSession()이 그 세션을 "현재 세션"으로
// 하이드레이션하는 방식으로 흡수됐다(RPA-100 아카이브·분석 메뉴 통합).
//
// 목록 자체는 서버 상태라 TanStack Query(useQuery)로 캐싱·조회하고, Pinia는 그 위에 기존
// 컴포넌트가 쓰던 sessions/listStatus/loadSessions() 등 동일한 인터페이스만 얇게 유지한다 —
// AppSidebar.vue·pipeline.js 등 소비 측 코드는 손대지 않는다.
const SESSIONS_QUERY_KEY = ["sessions"];

export const useArchiveStore = defineStore("archive", () => {
  const queryClient = useQueryClient();
  const deleteError = ref(""); // 목록 로드와 별개 — listStatus를 바꾸면 목록 자체가 화면에서 사라진다

  // enabled: false — 로그인 전엔 자동 조회하지 않고, 기존처럼 loadSessions() 호출(refetch)로만 트리거한다.
  const sessionsQuery = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async () => {
      const { sessions: rows } = await listSessions();
      return rows.map((s) => ({ ...s, dateLabel: formatDateLabel(s.updated_at ?? s.created_at) }));
    },
    enabled: false,
  });

  const sessions = computed(() => sessionsQuery.data.value ?? []);

  const listStatus = computed(() => {
    if (sessionsQuery.isFetching.value) return "loading";
    if (sessionsQuery.isError.value) return "error";
    if (sessionsQuery.isSuccess.value) return "done";
    return "idle";
  });

  const listError = computed(() => {
    const err = sessionsQuery.error.value;
    if (!err) return "";
    return err instanceof ApiError ? err.message : t("archive.errors.loadFailed");
  });

  async function loadSessions() {
    await sessionsQuery.refetch();
  }

  const deleteMutation = useMutation({ mutationFn: (id) => deleteSession(id) });

  async function removeSession(id) {
    deleteError.value = "";
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      deleteError.value = err instanceof ApiError ? err.message : t("archive.errors.deleteFailed");
      return false;
    }
    queryClient.setQueryData(SESSIONS_QUERY_KEY, (old) => (old ?? []).filter((s) => s.id !== id));
    return true;
  }

  function resetForLogout() {
    queryClient.removeQueries({ queryKey: SESSIONS_QUERY_KEY });
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
