// A small safe Markdown reader for model answers: paragraphs, bullet and numbered lists, **bold**, *italic*, `code`
// and [n] references. It returns a tree, never HTML: raw tags stay text and no link comes out of model text.

export type Inline = { t: "text" | "bold" | "italic" | "code"; text: string } | { t: "ref"; n: number };
export type Block = { t: "p"; inline: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(\d{1,3})\]/g;

// @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-safe-render
/** Inline spans of one line of text; everything else, including `<b>` and `[x](url)`, stays plain text. */
export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ t: "italic", text: m[2] });
    else if (m[3] !== undefined) out.push({ t: "code", text: m[3] });
    else out.push({ t: "ref", n: Number(m[4]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", text: s.slice(last) });
  return out;
}

/** Blocks of an answer: blank lines split paragraphs, `- `/`* ` and `1. ` lines make lists. */
export function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    const flush = () => para.length && (out.push({ t: "p", inline: inline(para.join(" ")) }), (para = []));
    for (const l of lines) {
      const item = /^([-*]|\d+\.)\s+(.*)$/.exec(l);
      if (!item) {
        para.push(l);
        continue;
      }
      flush();
      const kind = item[1] === "-" || item[1] === "*" ? "ul" : "ol";
      const prev = out[out.length - 1];
      if (prev && prev.t === kind) prev.items.push(inline(item[2]));
      else out.push({ t: kind, items: [inline(item[2])] });
    }
    flush();
  }
  return out;
}
// @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-safe-render
