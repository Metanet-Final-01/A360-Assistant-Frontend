export const CHAT_GREETING = "안녕하세요! A360 액션·패키지 사용법 등 궁금한 점을 무엇이든 물어보세요.";

export function nowTime() {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createInitialChatMessages() {
  return [{ role: "assistant", text: CHAT_GREETING, time: nowTime() }];
}

// 세션 이력의 chat-messages(created_at ISO)를 말풍선 표시용 시각으로 변환한다
export function timeLabel(iso) {
  if (!iso) return nowTime();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nowTime();
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
