import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import "../style.css";
import FlowWindowApp from "./FlowWindowApp.vue";
import { i18n } from "../i18n";

const app = createApp(FlowWindowApp);

// pipeline 스토어가 (거의 안 쓰지만) archive 스토어를 거쳐 간접적으로 useQuery를 참조할 수 있어
// 메인 앱(main.js)과 동일하게 설치해 둔다 — 없으면 그 경로를 타는 순간 에러로 창이 죽는다.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

app.config.errorHandler = (err, instance, info) => {
  console.error(`[FlowWindow] Unhandled error in ${instance?.$options?.name ?? "component"} (${info})`, err);
};

window.addEventListener("unhandledrejection", (event) => {
  console.error("[FlowWindow] Unhandled promise rejection", event.reason);
});

app.use(createPinia()).use(VueQueryPlugin, { queryClient }).use(i18n).mount("#app");
