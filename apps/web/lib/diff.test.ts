import { describe, expect, it } from "vitest";
import { wordDiff } from "./diff";

const joined = (parts: ReturnType<typeof wordDiff>["parts"], kind: string) => parts.filter((p) => p.kind === kind).map((p) => p.text).join("|");

describe("wordDiff", () => {
  it("marks only the words that changed", () => {
    const { parts } = wordDiff("Pinterest performance report", "Pinterest performance wins");
    expect(joined(parts, "removed")).toBe("report");
    expect(joined(parts, "added")).toBe("wins");
    expect(parts[0]).toEqual({ kind: "same", text: "Pinterest performance" });
  });

  it("returns one unchanged part for identical text and reconstructs both sides", () => {
    expect(wordDiff("same words", "same words")).toEqual({ parts: [{ kind: "same", text: "same words" }], similarity: 1 });
    const { parts } = wordDiff("a b c d", "a x c d e");
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join(" ")).toBe("a b c d");
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join(" ")).toBe("a x c d e");
  });

  it("does not scatter a rewrite: whitespace never anchors a match", () => {
    const { parts, similarity } = wordDiff("Spend was higher on Summit Weekend, and it returned more revenue", "Summit Weekend spent more and returned more revenue per dollar");
    expect(similarity).toBeLessThan(0.7);
    expect(parts.every((p) => !p.text.startsWith(" ") && !p.text.endsWith(" "))).toBe(true);
  });

  it("handles empty sides and ignores spacing differences", () => {
    expect(wordDiff("", "new text").parts).toEqual([{ kind: "added", text: "new text" }]);
    expect(wordDiff("old text", "").parts).toEqual([{ kind: "removed", text: "old text" }]);
    expect(wordDiff("a  b\n c", "a b c").similarity).toBe(1);
  });
});
