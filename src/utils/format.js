export function evidenceLabel(evidence) {
  if (!evidence) return "";
  const page = evidence.page != null ? `p.${evidence.page}` : "";
  const snippet = evidence.snippet ? `«${evidence.snippet}»` : "";
  return [page, snippet].filter(Boolean).join(" ");
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)}${units[unitIndex]}`;
}
