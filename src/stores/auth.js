import { defineStore } from "pinia";
import { ref } from "vue";
import { register as apiRegister, login as apiLogin, getMe } from "../api/auth";
import { getToken, setToken, clearToken } from "../api/http";
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
      clearToken();
    } finally {
      authChecking.value = false;
    }
  }

  async function loginWithPassword(email, password) {
    const { access_token } = await apiLogin(email, password);
    setToken(access_token);
    userEmail.value = email;
    isLoggedIn.value = true;
    useChatStore().dockChat(); // 로그인 직후 챗 위젯을 닫고 도킹 상태로 초기화
  }

  // 가입 API는 access_token을 바로 내려주지만(자동 로그인용), 제품 정책상 가입 후에는
  // 로그인 화면으로 보내고 사용자가 직접 로그인하도록 한다 — 그 토큰은 쓰지 않는다.
  async function registerWithPassword(email, password) {
    await apiRegister(email, password);
  }

  function logout() {
    usePipelineStore().resetUpload();
    clearToken();
    isLoggedIn.value = false;
    userEmail.value = null;
    useChatStore().resetForLogout();
    useArchiveStore().resetForLogout();
  }

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
