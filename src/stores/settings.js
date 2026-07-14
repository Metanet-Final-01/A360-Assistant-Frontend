import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LOCALE_KEY, i18n, setI18nLocale } from "../i18n";

const THEME_KEY = "a360.theme"; // "light" | "dark"

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

  // data-theme 속성을 <html>에 반영 — style.css의 :root[data-theme="dark"] 오버라이드가 이걸 본다.
  watch(
    theme,
    (value) => {
      document.documentElement.setAttribute("data-theme", value);
    },
    { immediate: true },
  );

  return { locale, theme, setLocale, setTheme, toggleTheme };
});
