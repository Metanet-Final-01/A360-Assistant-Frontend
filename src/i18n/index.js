import { createI18n } from "vue-i18n";
import ko from "./locales/ko";
import en from "./locales/en";

export const LOCALE_KEY = "a360.locale";
const SUPPORTED_LOCALES = ["ko", "en"];

function detectInitialLocale() {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  const browserLocale = navigator.language?.slice(0, 2);
  return SUPPORTED_LOCALES.includes(browserLocale) ? browserLocale : "ko";
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectInitialLocale(),
  fallbackLocale: "ko",
  messages: { ko, en },
});

// api/*.js, stores/*.js 등 컴포넌트 setup() 밖의 plain 모듈에서 쓰는 전역 접근자.
// useI18n()은 setup 컨텍스트가 필요하지만, legacy:false에서도 global 인스턴스의 t는
// 어디서든 호출 가능하다. 반드시 "호출 시점"에 불러써야 로케일 변경이 반영된다 — 모듈
// 최상단에서 즉시 평가해 상수에 담으면 안 된다.
export const t = (...args) => i18n.global.t(...args);
export function setI18nLocale(locale) {
  i18n.global.locale.value = locale;
}
export function getI18nLocale() {
  return i18n.global.locale.value;
}
