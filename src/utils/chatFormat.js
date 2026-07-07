const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function formatMessage(text) {
  const escaped = text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
