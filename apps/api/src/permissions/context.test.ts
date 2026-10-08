import { describe, expect, it } from "vitest";
import { impressionsBand, spendBand } from "./context.js";

describe("scale bands", () => {
  it("replace raw totals with coarse ranges", () => {
    expect(impressionsBand(120_000)).toBe("under 250k");
    expect(impressionsBand(1_200_000)).toBe("1M to 2.5M");
    expect(impressionsBand(3_000_000)).toBe("over 2.5M");
    expect(impressionsBand(null)).toBe("unavailable");
    expect(spendBand(2_900)).toBe("under 5k");
    expect(spendBand(12_600)).toBe("10k to 20k");
    expect(spendBand(50_000)).toBe("over 20k");
  });
});
