import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block } from "@exhibit/contracts";

export interface PdfMetric { label: string; display: string }

export interface PdfInput {
  title: string;
  kindLabel: string;
  version: number;
  label: "Draft" | "Approved";
  approvedAt: Date | null;
  createdAt: Date;
  /** Blocks with {{metric-id}} placeholders already filled with verified values. */
  blocks: Block[];
  /** Verified metrics by ID, for tables. */
  metrics: Record<string, PdfMetric>;
  claims: { verified: number; total: number } | null;
  accent: [number, number, number];
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const BODY_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.85, 0.85, 0.85);

const STATEMENT = {
  observation: { name: "OBSERVATION", color: rgb(0.0, 0.42, 0.45) },
  hypothesis: { name: "HYPOTHESIS · UNTESTED", color: rgb(0.62, 0.4, 0.0) },
  recommendation: { name: "RECOMMENDATION", color: rgb(0.2, 0.3, 0.7) },
  experiment: { name: "EXPERIMENT", color: rgb(0.2, 0.3, 0.7) },
  limitation: { name: "LIMITATION", color: rgb(0.45, 0.45, 0.45) },
} as const;

/** Standard PDF fonts cover Latin text only. Replace look-alikes, then drop anything left over. */
const SUBSTITUTIONS: Record<string, string> = { "→": "->", "←": "<-", "≈": "~", "−": "-", "≥": ">=", "≤": "<=", " ": " ", " ": " ", "…": "..." };

function clean(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const char of text.replace(/\s+/g, " ")) {
    const mapped = SUBSTITUTIONS[char] ?? char;
    for (const c of mapped) if (supported.has(c.codePointAt(0)!)) out += c;
  }
  return out;
}

/** A small, dependency-light layout: wrapped text, labelled statements, tables, page footer. */
export async function renderArtifactPdf(input: PdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  doc.setTitle(`${input.title} (${input.label}, version ${input.version})`);
  doc.setProducer("Exhibit A");
  doc.setCreator("Exhibit A");

  const accent = rgb(...input.accent);
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    if (input.label === "Draft") {
      page.drawText("DRAFT", { x: 120, y: 250, size: 130, font: bold, color: rgb(0.93, 0.93, 0.93), rotate: degrees(45) });
    }
    y = PAGE.height - MARGIN;
  };
  const ensure = (height: number) => { if (y - height < MARGIN + 24) newPage(); };

  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const word of clean(text, font).split(" ")) {
      if (!word) continue;
      let remaining = word;
      // A single word wider than the line is broken by character.
      while (font.widthOfTextAtSize(remaining, size) > width) {
        let cut = remaining.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(remaining.slice(0, cut), size) > width) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      const attempt = line ? `${line} ${remaining}` : remaining;
      if (font.widthOfTextAtSize(attempt, size) <= width) line = attempt;
      else { lines.push(line); line = remaining; }
    }
    if (line) lines.push(line);
    return lines;
  };

  /** Draws wrapped text line by line, starting a new page when needed. */
  const text = (value: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; leading?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    const leading = opts.leading ?? size * 1.45;
    const x = opts.x ?? MARGIN;
    for (const line of wrap(value, font, size, opts.width ?? BODY_WIDTH)) {
      ensure(leading);
      y -= leading;
      page.drawText(line, { x, y: y + size * 0.25, size, font, color: opts.color ?? INK });
    }
  };

  newPage();

  // Cover block
  page.drawRectangle({ x: MARGIN, y: y - 4, width: BODY_WIDTH, height: 3, color: accent });
  y -= 22;
  text(`${input.kindLabel.toUpperCase()}  ·  VERSION ${input.version}  ·  ${input.label.toUpperCase()}`, { font: bold, size: 8.5, color: MUTED });
  y -= 4;
  text(input.title, { font: bold, size: 22, leading: 28 });
  y -= 2;
  const dated = `Created ${input.createdAt.toISOString().slice(0, 10)}`;
  text(input.approvedAt ? `${dated}  ·  Approved ${input.approvedAt.toISOString().slice(0, 10)}` : `${dated}  ·  Not yet approved`, { size: 9, color: MUTED });
  y -= 14;

  const gap = (n = 8) => { y -= n; };

  const statement = (kind: keyof typeof STATEMENT, body: string, details: [string, string][] = [], heading?: string) => {
    const { name, color } = STATEMENT[kind];
    ensure(80);
    const top = y;
    text(name, { font: bold, size: 7.5, color, x: MARGIN + 12, width: BODY_WIDTH - 12 });
    if (heading) text(heading, { font: bold, size: 10.5, x: MARGIN + 12, width: BODY_WIDTH - 12 });
    text(body, { x: MARGIN + 12, width: BODY_WIDTH - 12 });
    for (const [label, value] of details) {
      gap(2);
      text(`${label}: ${value}`, { size: 9.5, color: MUTED, x: MARGIN + 12, width: BODY_WIDTH - 12 });
    }
    // The accent rule spans the statement, including pages it continues onto only on the first page.
    page.drawRectangle({ x: MARGIN, y, width: 2.5, height: Math.max(top - y, 4), color });
    gap(10);
  };

  const metricTable = (block: Extract<Block, { type: "metric_table" }>) => {
    const scopes = block.scopes;
    const names = block.metrics;
    const labelWidth = 150;
    const col = (BODY_WIDTH - labelWidth) / scopes.length;
    text(block.caption, { font: bold, size: 9, color: MUTED });
    gap(2);
    ensure(20 + 17 * 3);
    y -= 15;
    scopes.forEach((scope, i) => {
      const label = wrap(scope.label, bold, 8.5, col - 8)[0] ?? "";
      page.drawText(label, { x: MARGIN + labelWidth + col * (i + 1) - bold.widthOfTextAtSize(label, 8.5) - 4, y: y + 3, size: 8.5, font: bold, color: INK });
    });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + BODY_WIDTH, y }, thickness: 0.6, color: RULE });
    for (const name of names) {
      ensure(17);
      y -= 16;
      const first = input.metrics[`metric:${scopes[0]!.scopeId}:${name}`];
      page.drawText(clean(first?.label ?? name, regular), { x: MARGIN, y: y + 4, size: 9.5, font: regular, color: MUTED });
      scopes.forEach((scope, i) => {
        const metric = input.metrics[`metric:${scope.scopeId}:${name}`];
        const value = clean(metric?.display ?? "unavailable", regular);
        const font = metric ? regular : italic;
        const width = font.widthOfTextAtSize(value, 9.5);
        page.drawText(value, { x: MARGIN + labelWidth + col * (i + 1) - width - 4, y: y + 4, size: 9.5, font, color: INK });
      });
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + BODY_WIDTH, y }, thickness: 0.3, color: RULE });
    }
    gap(12);
  };

  for (const block of input.blocks) {
    switch (block.type) {
      case "heading": {
        const size = block.level === 1 ? 17 : block.level === 2 ? 13.5 : 11.5;
        gap(block.level === 1 ? 10 : 6);
        ensure(size * 3);
        text(block.text, { font: bold, size });
        gap(4);
        break;
      }
      case "paragraph": text(block.text); gap(8); break;
      case "metric_table": metricTable(block); break;
      case "observation": statement("observation", block.text); break;
      case "hypothesis": statement("hypothesis", block.text); break;
      case "recommendation":
        statement("recommendation", block.text, [["Why", block.reasoning], ["How to measure", block.measurement], ["Limit", block.limitation]]);
        break;
      case "experiment":
        statement("experiment", block.hypothesis, [["Design", block.design], ["How to measure", block.measurement], ["Limit", block.limitation]], block.title);
        break;
      case "limitation": statement("limitation", block.text); break;
    }
  }

  gap(6);
  ensure(40);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + BODY_WIDTH, y }, thickness: 0.6, color: RULE });
  if (input.claims) text(`Numerical claims verified against calculated metrics: ${input.claims.verified} of ${input.claims.total}.`, { size: 9, color: MUTED });
  text("Synthetic data for a fictional client.", { size: 9, color: MUTED });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = `Exhibit A  ·  ${input.label}  ·  Version ${input.version}  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(footer, { x: MARGIN, y: 30, size: 8, font: regular, color: MUTED });
  });

  return Buffer.from(await doc.save());
}
