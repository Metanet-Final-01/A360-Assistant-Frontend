// LLM 토큰은 네트워크상 burst로 도착한다(수십 개가 수 ms 간격으로 몰려옴) — 그대로 이어붙이면
// 화면엔 "한 번에 뜨는" 것처럼 보인다. 도착한 토큰을 큐에 쌓고 일정 페이스로 꺼내 붙여서,
// 도착 패턴과 무관하게 매끄러운 타이핑처럼 보이게 한다.
//
// 페이스는 큐 길이에 비례해 적응한다: 큐가 짧으면 한 글자씩(타자 느낌), 밀리면 틱당 여러
// 글자를 한꺼번에 흘려 어떤 길이의 답변도 몇 초 안에 따라잡는다. 고정 1글자/틱은 done으로
// 뭉치 답변이 왔을 때 80자에 수 분이 걸리는 문제가 있었다(브라우저 탭 비활성 시 setTimeout이
// 1초로 클램프되는 것까지 겹치면 치명적) — 그래서 최대 지연도 아래 상수로 상한을 둔다.
const TICK_MS = 16; // 틱 간격 — 사람 눈에 연속으로 보이는 수준
const CATCH_UP_TICKS = 60; // 어떤 큐든 이 틱 수(≈1초) 안에 다 흘리도록 틱당 글자 수를 조절

export function createTypewriter(message, { tickMs = TICK_MS } = {}) {
  let queue = "";
  let timer = null;
  let started = false;

  function tick() {
    if (!queue) {
      timer = null;
      return;
    }
    const take = Math.max(1, Math.ceil(queue.length / CATCH_UP_TICKS));
    message.text += queue.slice(0, take);
    queue = queue.slice(take);
    timer = setTimeout(tick, tickMs);
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
