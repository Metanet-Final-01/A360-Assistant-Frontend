import { getI18nLocale } from "../i18n";

const INTL_LOCALE = { ko: "ko-KR", en: "en-US" };

function intlLocale() {
  return INTL_LOCALE[getI18nLocale()] ?? "ko-KR";
}

// stores/archive.js의 세션 목록 표시용 날짜
export function formatDateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
}

// flow-window(FlowWindowApp.vue)의 버전 이력 날짜
export function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" });
}

// utils/chatMessages.js의 말풍선 시각
export function formatTime(date = new Date()) {
  return date.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function formatTimeFromIso(iso) {
  if (!iso) return formatTime();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? formatTime() : formatTime(d);
}
