import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import "./style.css";
import App from "./App.vue";
import { i18n } from "./i18n";

const app = createApp(App);

// 서버 상태(세션 목록 등) 캐싱·리페칭 전담. apiRequest(src/api/http.js)가 이미 401 갱신·재시도를
// 처리하므로 여기서 또 retry하면 실패 응답을 중복으로 재요청하게 된다 — retry는 끈다.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// 컴포넌트 렌더/watcher/라이프사이클 훅에서 던진 예외는 기본적으로 콘솔에만 찍히고 화면은
// 부분적으로 깨진 채 남는다 — 최소한 어느 컴포넌트에서 무슨 에러였는지 남겨 재현·진단이
// 가능하게 한다. 각 스토어·api 계층은 이미 자체적으로 try/catch하므로, 여기 도달하는 건
// 예상 못한 버그(널 참조 등)다.
app.config.errorHandler = (err, instance, info) => {
  console.error(`[App] Unhandled error in ${instance?.$options?.name ?? "component"} (${info})`, err);
};

window.addEventListener("unhandledrejection", (event) => {
  console.error("[App] Unhandled promise rejection", event.reason);
});

app.use(createPinia()).use(VueQueryPlugin, { queryClient }).use(i18n).mount("#app");
