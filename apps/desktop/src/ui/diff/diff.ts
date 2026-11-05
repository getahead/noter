// Word diff of the diff view (prototype C.diffView): LCS over whitespace-separated tokens.
// Over MAX_LINES lines a side is compared line by line, which keeps the quadratic table small.
export const MAX_LINES = 60;

export type Op = "eq" | "ins" | "del";
export interface Part {
  op: Op;
  text: string;
}

export function diffWords(before: string, after: string): Part[] {
  const split = before.split("\n").length > MAX_LINES || after.split("\n").length > MAX_LINES ? /(\n)/ : /(\s+)/;
  const a = before.split(split).filter(Boolean);
  const b = after.split(split).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Part[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ op: "eq", text: a[i++]! }), j++;
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: "del", text: a[i++]! });
    else out.push({ op: "ins", text: b[j++]! });
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "ins", text: b[j++]! });
  return out;
}

/** Changed words (whitespace tokens do not count). */
export const changedWords = (parts: Part[]) => parts.filter((p) => p.op !== "eq" && p.text.trim()).length;

export type Line = { parts: Part[]; same: boolean };

/** The parts split at line breaks; a line is `same` when nothing in it changed. */
export function toLines(parts: Part[]): Line[] {
  const lines: Part[][] = [[]];
  for (const p of parts) {
    const pieces = p.text.split("\n");
    pieces.forEach((s, k) => {
      if (k > 0) lines.push([]);
      if (s) lines[lines.length - 1]!.push({ op: p.op, text: s });
    });
    // a deleted or inserted line break still ends the line it is on
  }
  return lines.map((l) => ({ parts: l, same: l.every((p) => p.op === "eq") }));
}

export type Block = { kind: "lines"; lines: Line[] } | { kind: "fold"; lines: Line[] };

/** Runs of more than `keep` unchanged lines fold into one block (**N unchanged lines**). */
export function fold(lines: Line[], keep = 3): Block[] {
  const blocks: Block[] = [];
  let run: Line[] = [];
  const flush = () => {
    if (run.length) blocks.push({ kind: run.length > keep ? "fold" : "lines", lines: run });
    run = [];
  };
  for (const l of lines) {
    if (l.same) run.push(l);
    else {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "lines") last.lines.push(l);
      else blocks.push({ kind: "lines", lines: [l] });
    }
  }
  flush();
  return blocks;
}
