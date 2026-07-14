import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

// VITE_API_BASE_URL이 미설정이면 API 클라이언트들(src/api/*.js)은 http://localhost:8000로
// 폴백한다 — index.html의 %VITE_API_BASE_URL% preconnect/dns-prefetch도 같은 값을 봐야 하므로
// (Vite의 %ENV_NAME% 치환은 폴백 문법이 없어 미설정 시 플레이스홀더 문자열이 그대로 남는다)
// 여기서 한 번만 폴백을 적용해 JS 번들과 HTML 치환 양쪽에 동일하게 주입한다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL || "http://localhost:8000";

  return {
    plugins: [vue()],
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_JIT_COMPILATION__: true,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
    server: {
      // Windows 호스트 ↔ Docker 바인드 마운트는 inotify 파일 이벤트가 컨테이너로 전달되지 않아
      // Vite가 소스 변경을 감지하지 못한다(HMR 무동작 → 저장해도 화면에 반영 안 됨). 폴링으로
      // 주기 감시해 저장 즉시 HMR 되게 한다. 이 팀은 Docker 스택으로 개발하므로 기본 on이되,
      // 네이티브 FS(이벤트 감시 정상·폴링은 CPU 낭비)에서는 VITE_USE_POLLING=false로 끌 수 있다.
      watch: { usePolling: env.VITE_USE_POLLING !== "false", interval: 300 },
    },
  };
});
