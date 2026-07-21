// 흐름도(Recommendation)를 사람이 읽는 문서 형식으로 직렬화 — FR-17. 백엔드 export API는
// JSON 봉투만 내려주므로(P1-3, 골든셋 채점 포맷 고정) Markdown/DOCX 변환은 순수 프론트에서 한다.
// 라벨/패키지 폴백 규칙은 recommendation.js(캔버스·상세 패널이 쓰는 규칙)와 동일하게 맞춘다.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { t } from "../i18n";
import { formatParamValue } from "./recommendation";

function labelOf(node) {
  return node.label || node.action || t("recommendation.untitledAction");
}
function packageOf(node) {
  return node.package || t("common.unspecified");
}

// steps[].actions[].children[]... 트리를 순서대로 훑어 { type:"step", ... } / { num, depth, node }
// 행 목록으로 펼친다 — flowLayout.computePrefixes와 같은 번호 규칙(스텝을 가로지르는 전역 카운터,
// 자식은 부모 접두어에 이어붙임)이라 화면에서 보던 번호와 문서의 번호가 일치한다.
function buildOutline(steps) {
  const rows = [];
  let n = 0;
  function walkChildren(prefix, depth, children) {
    (children ?? []).forEach((c, i) => {
      const num = `${prefix}.${i + 1}`;
      rows.push({ num, depth, node: c });
      if (c.children?.length) walkChildren(num, depth + 1, c.children);
    });
  }
  (steps ?? []).forEach((step, stepIdx) => {
    rows.push({ type: "step", step, stepIdx });
    (step.actions ?? []).forEach((a) => {
      n += 1;
      const num = String(n);
      rows.push({ num, depth: 0, node: a });
      if (a.children?.length) walkChildren(num, 1, a.children);
    });
  });
  return rows;
}

function varLine(v) {
  return `${v.name} (${v.type})${v.description ? ` — ${v.description}` : ""}`;
}

export function recommendationToMarkdown(recommendation, { documentTitle } = {}) {
  const lines = [`# ${documentTitle || t("recommendDetail.recommendSectionTitle")}`];
  if (recommendation?.notes) lines.push("", recommendation.notes);

  const variables = recommendation?.variables ?? [];
  const inputVars = variables.filter((v) => v.direction === "input");
  const outputVars = variables.filter((v) => v.direction === "output");
  if (inputVars.length) {
    lines.push("", `## ${t("recommendDetail.inputVars")}`, ...inputVars.map((v) => `- ${varLine(v)}`));
  }
  if (outputVars.length) {
    lines.push("", `## ${t("recommendDetail.outputVars")}`, ...outputVars.map((v) => `- ${varLine(v)}`));
  }

  const sourceFootnotes = [];
  buildOutline(recommendation?.steps ?? []).forEach((row) => {
    if (row.type === "step") {
      lines.push(
        "",
        `## ${row.step.label || row.step.step_id || t("recommendation.stepFallback", { n: row.stepIdx + 1 })}`,
      );
      if (row.step.description) lines.push(row.step.description);
      return;
    }
    const node = row.node;
    const indent = "  ".repeat(row.depth);
    lines.push(`${indent}${row.num}. **${labelOf(node)}** \`${packageOf(node)}\``);
    (node.parameters ?? []).forEach((p) => lines.push(`${indent}   - ${p.name}: ${formatParamValue(p.value)}`));
    if (node.rationale) lines.push(`${indent}   - ${t("recommendDetail.rationaleLabel")}: ${node.rationale}`);
    if (node.confidence != null) {
      lines.push(`${indent}   - ${t("recommendDetail.confidenceLabel")}: ${Math.round(node.confidence * 100)}%`);
    }
    if (node.sources?.length) {
      const refs = node.sources.map((s) => {
        sourceFootnotes.push(s);
        return `[${sourceFootnotes.length}]`;
      });
      lines.push(`${indent}   - ${t("recommendDetail.sourcesLabel")}: ${refs.join(" ")}`);
    }
  });

  if (sourceFootnotes.length) {
    lines.push("", `## ${t("recommendDetail.sourcesLabel")}`);
    sourceFootnotes.forEach((s, i) => {
      const title = s.title || t("chat.untitledSource");
      lines.push(s.url ? `[${i + 1}] [${title}](${s.url})` : `[${i + 1}] ${title}`);
    });
  }

  return lines.join("\n");
}

export async function recommendationToDocxBlob(recommendation, { documentTitle } = {}) {
  const children = [
    new Paragraph({ text: documentTitle || t("recommendDetail.recommendSectionTitle"), heading: HeadingLevel.HEADING_1 }),
  ];
  if (recommendation?.notes) children.push(new Paragraph({ text: recommendation.notes }));

  const variables = recommendation?.variables ?? [];
  const inputVars = variables.filter((v) => v.direction === "input");
  const outputVars = variables.filter((v) => v.direction === "output");
  function pushVarSection(heading, vars) {
    if (!vars.length) return;
    children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }));
    vars.forEach((v) => children.push(new Paragraph({ text: varLine(v), bullet: { level: 0 } })));
  }
  pushVarSection(t("recommendDetail.inputVars"), inputVars);
  pushVarSection(t("recommendDetail.outputVars"), outputVars);

  const sourceFootnotes = [];
  buildOutline(recommendation?.steps ?? []).forEach((row) => {
    if (row.type === "step") {
      children.push(
        new Paragraph({
          text: row.step.label || row.step.step_id || t("recommendation.stepFallback", { n: row.stepIdx + 1 }),
          heading: HeadingLevel.HEADING_2,
        }),
      );
      if (row.step.description) children.push(new Paragraph({ text: row.step.description }));
      return;
    }
    const node = row.node;
    const indent = { left: 360 * (row.depth + 1) };
    const detailIndent = { left: 360 * (row.depth + 2) };
    children.push(
      new Paragraph({
        indent,
        children: [
          new TextRun({ text: `${row.num}. `, bold: true }),
          new TextRun({ text: labelOf(node), bold: true }),
          new TextRun({ text: ` (${packageOf(node)})` }),
        ],
      }),
    );
    (node.parameters ?? []).forEach((p) =>
      children.push(new Paragraph({ indent: detailIndent, text: `${p.name}: ${formatParamValue(p.value)}` })),
    );
    if (node.rationale) {
      children.push(
        new Paragraph({ indent: detailIndent, text: `${t("recommendDetail.rationaleLabel")}: ${node.rationale}` }),
      );
    }
    if (node.confidence != null) {
      children.push(
        new Paragraph({
          indent: detailIndent,
          text: `${t("recommendDetail.confidenceLabel")}: ${Math.round(node.confidence * 100)}%`,
        }),
      );
    }
    if (node.sources?.length) {
      const refs = node.sources.map((s) => {
        sourceFootnotes.push(s);
        return `[${sourceFootnotes.length}]`;
      });
      children.push(
        new Paragraph({ indent: detailIndent, text: `${t("recommendDetail.sourcesLabel")}: ${refs.join(" ")}` }),
      );
    }
  });

  if (sourceFootnotes.length) {
    children.push(new Paragraph({ text: t("recommendDetail.sourcesLabel"), heading: HeadingLevel.HEADING_2 }));
    sourceFootnotes.forEach((s, i) => {
      const title = s.title || t("chat.untitledSource");
      children.push(new Paragraph({ text: `[${i + 1}] ${title}${s.url ? ` ${s.url}` : ""}` }));
    });
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}
