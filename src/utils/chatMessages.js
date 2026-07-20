import { t } from "../i18n";
import { formatTime, formatTimeFromIso } from "./dateFormat";

export function getChatGreeting() {
  return t("chat.greeting");
}

export function createInitialChatMessages() {
  return [{ role: "assistant", text: getChatGreeting(), time: formatTime() }];
}

// 세션 이력의 chat-messages(created_at ISO)를 말풍선 표시용 시각으로 변환한다
export function timeLabel(iso) {
  return formatTimeFromIso(iso);
}
