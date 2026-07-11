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
    },
  };
});
