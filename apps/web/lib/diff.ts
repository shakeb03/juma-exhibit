export interface DiffPart {
  text: string;
  kind: "same" | "removed" | "added";
}

export interface WordDiff {
  parts: DiffPart[];
  /** Share of the longer text's words that both versions have in common, from 0 to 1. */
  similarity: number;
}

/**
 * Word-level difference between two texts, for showing a proposed edit against the original. Whitespace is not
 * compared (it would match everywhere and scatter the changes); parts are joined with single spaces when shown.
 */
export function wordDiff(before: string, after: string): WordDiff {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  // Longest common subsequence over words; the texts are short (one block field), so a full table is fine.
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const words: { word: string; kind: DiffPart["kind"] }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { words.push({ word: a[i]!, kind: "same" }); i++; j++; }
    // Removed words come before added ones within a changed stretch, so a replacement reads "old new".
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) words.push({ word: a[i++]!, kind: "removed" });
    else words.push({ word: b[j++]!, kind: "added" });
  }
  while (i < a.length) words.push({ word: a[i++]!, kind: "removed" });
  while (j < b.length) words.push({ word: b[j++]!, kind: "added" });

  const parts: DiffPart[] = [];
  for (const { word, kind } of words) {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += ` ${word}`;
    else parts.push({ text: word, kind });
  }
  const same = words.filter((w) => w.kind === "same").length;
  return { parts, similarity: Math.max(a.length, b.length) === 0 ? 1 : same / Math.max(a.length, b.length) };
}
