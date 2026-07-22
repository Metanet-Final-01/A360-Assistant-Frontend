import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LOCALE_KEY, i18n, setI18nLocale } from "../i18n";
import { getAgentVersions } from "../api/agent";

const THEME_KEY = "a360.theme"; // "light" | "dark"
const AGENT_VERSION_KEY = "a360.agent_version"; // 선택한 에이전트 버전 id (테마·로케일과 동일한 지속 패턴)

function detectPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useSettingsStore = defineStore("settings", () => {
  const locale = ref(i18n.global.locale.value);
  const theme = ref(detectPreferredTheme());

  function setLocale(next) {
    locale.value = next;
    setI18nLocale(next);
    localStorage.setItem(LOCALE_KEY, next);
  }

  function setTheme(next) {
    theme.value = next;
    localStorage.setItem(THEME_KEY, next);
  }

  function toggleTheme() {
    setTheme(theme.value === "dark" ? "light" : "dark");
  }

  // ----- 에이전트 버전 선택 (RPA-167) -----
  // 목록은 GET /api/agent/versions로만 구성한다(하드코딩 금지 — v3 추가 시 자동 반영).
  // agentVersion이 null이면 /turn 요청에서 agent_version 필드를 생략해 백엔드 기본으로 동작한다
  // — 버전 선택은 부가기능이라 목록 로드 실패가 본 기능(챗·분석·추천)을 막으면 안 된다.
  const agentVersion = ref(null); // 현재 유효 선택 (id) | null
  const agentVersions = ref([]); // versions[] 원본: { id, label, description, default }
  const agentVersionsStatus = ref("idle"); // idle | loading | done | error

  // 진행 중이거나 끝난 시도를 다른 호출자와 공유한다 — 반환값 없이 fire-and-forget으로
  // 부르면(아래 부팅 시 1회 호출) 챗/분석/추천 턴을 이 로드보다 먼저 보내버릴 수 있어,
  // 저장해 둔 버전 선택이 첫 턴에는 반영 안 되고 백엔드 기본값으로 나갈 위험이 있다 —
  // 턴을 보내는 쪽은 이 promise를 await해서 복원이 끝난 뒤에 agentVersion을 읽는다.
  let loadAgentVersionsPromise = null;

  function loadAgentVersions() {
    // done이면 캐시 재사용, error면 재호출 시 재시도 허용
    if (agentVersionsStatus.value === "loading" || agentVersionsStatus.value === "done") {
      return loadAgentVersionsPromise;
    }
    agentVersionsStatus.value = "loading";
    loadAgentVersionsPromise = (async () => {
      try {
        const { versions, default: defaultId } = await getAgentVersions();
        agentVersions.value = versions ?? [];
        const saved = localStorage.getItem(AGENT_VERSION_KEY);
        if (saved && agentVersions.value.some((v) => v.id === saved)) {
          agentVersion.value = saved;
        } else {
          // 저장값이 없거나 목록에서 내려간 버전이면 백엔드 default로 리셋
          if (saved) localStorage.removeItem(AGENT_VERSION_KEY);
          agentVersion.value = defaultId ?? agentVersions.value.find((v) => v.default)?.id ?? null;
        }
        agentVersionsStatus.value = "done";
      } catch {
        agentVersionsStatus.value = "error";
        agentVersions.value = [];
        agentVersion.value = null; // 목록을 모르면 보내지 않는다 — 백엔드 기본 버전으로 동작
      }
    })();
    return loadAgentVersionsPromise;
  }

  function setAgentVersion(id) {
    if (!agentVersions.value.some((v) => v.id === id)) return; // 목록에 없는 id는 무시
    agentVersion.value = id;
    localStorage.setItem(AGENT_VERSION_KEY, id);
  }

  loadAgentVersions(); // 앱 부팅 시 1회 — 실패하면 챗 패널의 버전 드롭다운이 숨겨진다(새로고침 시 재시도)

  // data-theme 속성을 <html>에 반영 — style.css의 :root[data-theme="dark"] 오버라이드가 이걸 본다.
  watch(
    theme,
    (value) => {
      document.documentElement.setAttribute("data-theme", value);
    },
    { immediate: true },
  );

  // 흐름도 별도 창(flow-window)처럼 같은 오리진에 떠 있는 다른 창에서 테마를 바꾸면, storage
  // 이벤트는 그 변경을 일으킨 창 자신에게는 안 오고 "다른" 같은 오리진 창에만 온다 — 그 다른
  // 창들도 새로고침 없이 즉시 따라가게 한다.
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      theme.value = event.newValue;
    }
  });

  return {
    locale,
    theme,
    setLocale,
    setTheme,
    toggleTheme,
    agentVersion,
    agentVersions,
    agentVersionsStatus,
    loadAgentVersions,
    setAgentVersion,
  };
});
