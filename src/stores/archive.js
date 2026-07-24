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

  // 활성 세션에 분석·비전 보강 등 진행 중인 작업이 있으면 그 요청도 같은 DB 커넥션 풀을
  // 오래 붙들고 있어(RPA-264 — 삭제 중에도 작업을 취소하지 않기로 함), DELETE 응답이 눈에
  // 띄게 늦게 올 때가 있다. 응답을 기다렸다 목록을 지우면 "삭제가 바로 반영 안 되는" 것처럼
  // 보이므로, 목록에서는 요청 즉시(낙관적으로) 지우고 실패했을 때만 되돌린다.
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteSession(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });
      const previous = queryClient.getQueryData(SESSIONS_QUERY_KEY);
      queryClient.setQueryData(SESSIONS_QUERY_KEY, (old) => (old ?? []).filter((s) => s.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previous);
    },
  });

  async function removeSession(id) {
    deleteError.value = "";
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      deleteError.value = err instanceof ApiError ? err.message : t("archive.errors.deleteFailed");
      return false;
    }
    return true;
  }

  function resetForLogout() {
    queryClient.removeQueries({ queryKey: SESSIONS_QUERY_KEY });
    deleteError.value = "";
  }

  // PATCH 응답(갱신된 세션 객체)을 캐시의 해당 행에만 반영한다 (RPA-286, Qodo 리뷰).
  // 전체 목록 refetch로도 되지만 한 필드 바꾸자고 목록을 다시 받는 건 낭비고, 응답이 이미
  // 갱신된 세션이라 그걸 쓰면 왕복이 하나 줄고 배지도 즉시 바뀐다. dateLabel은 목록 로더가
  // 붙이는 파생 필드라 여기서도 같이 다시 계산한다(안 하면 갱신 후 날짜 라벨이 사라진다).
  function applySessionPatch(updated) {
    if (!updated?.id) return;
    queryClient.setQueryData(SESSIONS_QUERY_KEY, (old) =>
      (old ?? []).map((s) =>
        s.id === updated.id
          ? { ...s, ...updated, dateLabel: formatDateLabel(updated.updated_at ?? updated.created_at) }
          : s,
      ),
    );
  }

  return {
    sessions,
    applySessionPatch,
    listStatus,
    listError,
    deleteError,
    loadSessions,
    removeSession,
    resetForLogout,
  };
});
