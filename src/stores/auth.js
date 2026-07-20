import { defineStore } from "pinia";
import { ref } from "vue";
import { register as apiRegister, login as apiLogin, logout as apiLogout, getMe } from "../api/auth";
import { getToken, getRefreshToken, setTokens, clearTokens, setUnauthorizedHandler } from "../api/http";
import { usePipelineStore } from "./pipeline";
import { useChatStore } from "./chat";
import { useArchiveStore } from "./archive";

export const useAuthStore = defineStore("auth", () => {
  const isLoggedIn = ref(false);
  const authChecking = ref(true); // 앱 시작 시 저장된 토큰 유효성(GET /api/auth/me) 확인 중
  const userEmail = ref(null);

  // 앱 시작 시 1회 호출. 저장된 토큰이 있으면 GET /api/auth/me로 유효성을 확인해 자동 로그인한다.
  async function bootstrapAuth() {
    const token = getToken();
    if (!token) {
      authChecking.value = false;
      return;
    }
    try {
      const me = await getMe();
      userEmail.value = me.email;
      isLoggedIn.value = true;
    } catch {
      clearTokens();
    } finally {
      authChecking.value = false;
    }
  }

  async function loginWithPassword(email, password) {
    const { access_token, refresh_token } = await apiLogin(email, password);
    setTokens(access_token, refresh_token);
    userEmail.value = email;
    isLoggedIn.value = true;
    useChatStore().dockChat(); // 로그인 직후 챗 위젯을 닫고 도킹 상태로 초기화
  }

  // 가입 API는 토큰을 바로 내려주지만(자동 로그인용), 제품 정책상 가입 후에는
  // 로그인 화면으로 보내고 사용자가 직접 로그인하도록 한다 — 그 토큰은 쓰지 않는다.
  async function registerWithPassword(email, password) {
    await apiRegister(email, password);
  }

  function logout() {
    // 로컬 상태 정리보다 먼저 호출해야 아직 지우지 않은 액세스 토큰으로 Authorization 헤더가
    // 붙는다(붙지 않아도 서버는 body의 refresh_token만으로 세션을 끊는다). 서버 응답을 기다리지
    // 않는 베스트 에포트 호출 — 실패해도 로컬 로그아웃은 그대로 진행한다(204는 멱등이라
    // 이미 폐기된 토큰이어도 안전).
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      apiLogout(refreshToken).catch(() => {});
    }
    usePipelineStore().resetUpload();
    clearTokens();
    isLoggedIn.value = false;
    userEmail.value = null;
    useChatStore().resetForLogout();
    useArchiveStore().resetForLogout();
    // 분석 화면 패널(usePanelReorder)은 App.vue 루트에서 세션을 넘나들며 살아있어
    // handleLogout에서 별도로 초기화한다(analysisPanels.resetToDefault()).
  }

  // 어떤 API든 401(토큰 만료/무효)을 받으면 http.js가 이 핸들러를 부른다 — 상태를 로그아웃으로
  // 되돌리면 App.vue가 로그인 화면을 그린다. 토큰은 notifyUnauthorized()가 이미 지웠다.
  setUnauthorizedHandler(() => {
    if (isLoggedIn.value) logout();
  });

  return {
    isLoggedIn,
    authChecking,
    userEmail,
    bootstrapAuth,
    loginWithPassword,
    registerWithPassword,
    logout,
  };
});
