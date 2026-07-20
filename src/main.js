import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import { i18n } from "./i18n";

const app = createApp(App);

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

app.use(createPinia()).use(i18n).mount("#app");
