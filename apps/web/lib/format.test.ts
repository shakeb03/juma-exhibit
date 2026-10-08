import { describe, expect, it } from "vitest";
import { accentFor, extractIds, formatDuration, formatInput, initialsOf, periodLabel, relativeTime, segmentText } from "./format";

describe("segmentText", () => {
  it("splits text around metric placeholders so each number can be inspected", () => {
    expect(segmentText("CTR was {{metric:A:ctr}} against {{ metric:B:ctr }}.")).toEqual([
      { type: "text", value: "CTR was " },
      { type: "metric", id: "metric:A:ctr" },
      { type: "text", value: " against " },
      { type: "metric", id: "metric:B:ctr" },
      { type: "text", value: "." },
    ]);
  });
  it("returns plain text unchanged and handles a leading or trailing placeholder", () => {
    expect(segmentText("No numbers here.")).toEqual([{ type: "text", value: "No numbers here." }]);
    expect(segmentText("{{x}}")).toEqual([{ type: "metric", id: "x" }]);
  });
});

describe("formatInput", () => {
  const rate = { unit: "percent", change: "none", currency: null };
  const money = { unit: "currency", change: "absolute", currency: "USD" };
  it("formats money, counts, and compared values by their unit", () => {
    expect(formatInput("spend", 12600, rate)).toBe("12,600");
    expect(formatInput("spend", 12600, { ...rate, currency: "USD" })).toBe("$12,600");
    expect(formatInput("clicks", 33800, rate)).toBe("33,800");
    expect(formatInput("from", 0.026, rate)).toBe("2.60%");
    expect(formatInput("to", 0.8056, money)).toBe("$0.81");
  });
  it("never shows a missing value as zero", () => {
    expect(formatInput("clicks", null, rate)).toBe("unavailable");
  });
});

describe("labels and times", () => {
  it("formats durations and relative times", () => {
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(20_600)).toBe("20.6 s");
    expect(formatDuration(95_000)).toBe("1 min 35 s");
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(relativeTime("2026-10-08T11:59:55Z", now)).toBe("just now");
    expect(relativeTime("2026-10-08T11:30:00Z", now)).toBe("30 min ago");
  });
  it("describes the reporting period", () => {
    expect(periodLabel(null)).toBe("No campaign data");
    expect(periodLabel({ first: "2026-08", last: "2026-09" })).toMatch(/Aug 2026 to Sep/);
    expect(periodLabel({ first: "2026-09", last: "2026-09" })).toMatch(/Sep/);
  });
  it("gives each client its own accent and initials, with a neutral fallback", () => {
    expect(accentFor("ridgeline-outfitters")).not.toBe(accentFor("marlowe-finch"));
    expect(accentFor("unknown")).toBe("#075e61");
    expect(initialsOf("Marlowe & Finch")).toBe("MF");
    expect(initialsOf("Ridgeline Outfitters")).toBe("RO");
  });
});

describe("extractIds", () => {
  it("lists every metric a piece of text cites", () => {
    expect(extractIds("A {{metric:X:ctr}} and {{cmp:X->Y:ctr:rel}}; none here.")).toEqual(["metric:X:ctr", "cmp:X->Y:ctr:rel"]);
    expect(extractIds("plain")).toEqual([]);
  });
});
