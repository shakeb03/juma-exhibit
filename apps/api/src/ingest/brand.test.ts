import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBrandContext } from "./brand.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/clients");

describe("parseBrandContext", () => {
  it("splits named sections and ignores the rest", () => {
    const result = parseBrandContext("# Title\nintro\n## Brand voice\nWarm.\n\n## Audience\nAdults.\n## Unknown\nignored\n");
    expect(result).toEqual({ brandVoice: "Warm.", audience: "Adults.", goals: "", constraints: "", standingInstructions: "" });
  });

  it("reads every field from a real fixture", () => {
    const brand = parseBrandContext(readFileSync(join(fixtures, "marlowe-finch/brand.md"), "utf8"));
    expect(brand.brandVoice).toMatch(/letter from a small workshop/);
    expect(brand.audience).toMatch(/35 to 60/);
    expect(brand.goals).toMatch(/repeat purchases/);
    expect(brand.constraints).toMatch(/Never use discount or urgency language/);
    expect(brand.standingInstructions).toMatch(/Reports open with conversions/);
  });

  it("leaves absent sections empty", () => {
    const brand = parseBrandContext(readFileSync(join(fixtures, "velvet-static/brand.md"), "utf8"));
    expect(brand.standingInstructions).toBe("");
    expect(brand.constraints).not.toBe("");
  });
});
