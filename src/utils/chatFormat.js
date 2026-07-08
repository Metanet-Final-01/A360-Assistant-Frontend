import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: false, // 원문 내 raw HTML 비허용 (보안)
  linkify: true, // URL 자동 링크
  breaks: true, // 단일 줄바꿈도 <br> 처리 (채팅 UX에 맞음)
});

// 외부 링크는 새 탭 + rel 보안 속성 추가
const defaultRender =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultRender(tokens, idx, options, env, self);
};

export function formatMessage(text) {
  if (!text) return "";
  const html = md.render(text);
  // DOMPurify는 target 속성을 기본 허용 목록에 두지 않으므로 명시적으로 추가한다.
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}
