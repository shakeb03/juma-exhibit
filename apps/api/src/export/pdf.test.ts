import { describe, expect, it } from "vitest";
import type { Block } from "@exhibit/contracts";
import { renderArtifactPdf, type PdfInput } from "./pdf.js";

const base: PdfInput = {
  title: "Pinterest report — “Summer” €1,234 → up",
  kindLabel: "Performance report",
  version: 2,
  label: "Draft",
  approvedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  claims: { verified: 3, total: 3 },
  accent: [0, 0.5, 0.5],
  metrics: { "metric:A:roas": { label: "ROAS", display: "3.2x" } },
  blocks: [
    { id: "1", type: "heading", level: 1, text: "Summary" },
    { id: "2", type: "paragraph", text: "word ".repeat(600) },
    { id: "3", type: "metric_table", caption: "Compare", scopes: [{ label: "A", scopeId: "A" }, { label: "B", scopeId: "B" }], metrics: ["roas"] },
    { id: "4", type: "observation", text: "ROAS was 3.2x.", metricIds: [], sourceRefs: [] },
    { id: "5", type: "recommendation", text: "Do it.", reasoning: "Because.", basedOn: [], measurement: "Track.", limitation: "Small." },
    { id: "6", type: "paragraph", text: "x".repeat(400) },
  ] as Block[],
};

describe("renderArtifactPdf", () => {
  it("produces a multi-page PDF and survives characters outside the standard font", async () => {
    const pdf = await renderArtifactPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("renders approved exports without throwing", async () => {
    const pdf = await renderArtifactPdf({ ...base, label: "Approved", approvedAt: new Date("2026-10-02T00:00:00Z") });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
