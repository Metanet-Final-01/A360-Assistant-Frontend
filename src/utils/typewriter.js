// LLM 토큰은 네트워크상 burst로 도착한다(수십 개가 수 ms 간격으로 몰려옴) — 그대로 이어붙이면
// 화면엔 "한 번에 뜨는" 것처럼 보인다. 도착한 토큰을 큐에 쌓고 일정 속도로 한 글자씩 꺼내
// 붙여서, 도착 패턴과 무관하게 항상 매끄러운 타이핑처럼 보이게 한다.
export function createTypewriter(message, { charDelayMs = 20 } = {}) {
  let queue = "";
  let timer = null;
  let started = false;

  function tick() {
    if (!queue) {
      timer = null;
      return;
    }
    message.text += queue[0];
    queue = queue.slice(1);
    timer = setTimeout(tick, charDelayMs);
  }

  function push(token) {
    if (!token) return;
    started = true;
    queue += token;
    if (!timer) tick();
  }

  // 스트림 종료(done/error) 시 남은 큐를 애니메이션 없이 바로 반영한다 — 응답이 끝났는데
  // 화면에서 계속 타이핑되는 어색함을 막는다.
  function finish() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue) {
      message.text += queue;
      queue = "";
    }
  }

  return {
    push,
    finish,
    get started() {
      return started;
    },
  };
}
