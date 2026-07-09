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
