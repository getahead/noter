import type { SegmentView, TextRange } from "../../core/bindings";

export interface SplitPoint {
  seg: SegmentView;
  at: number;
  anchor: HTMLElement;
}

export function wordAt(text: string, offset: number): TextRange | null {
  for (const word of text.matchAll(/[^\p{White_Space}]+/gu)) {
    const start = word.index;
    const end = start + word[0].length;
    if (offset >= start && offset <= end) return { start, end };
  }
  return null;
}

export function splitAt(text: string, at: number): boolean {
  const word = wordAt(text, at);
  return word?.start === at && text.slice(0, at).trim().length > 0;
}

export function splitTime(seg: SegmentView, at: number, measured?: number): number {
  const duration = seg.t1_ms - seg.t0_ms;
  const elapsed = Math.floor([...seg.text.slice(0, at)].length * duration / [...seg.text].length);
  return measured ?? seg.t0_ms + Math.max(1, Math.min(elapsed, duration - 1));
}

/** DOM ranges account for term buttons and find highlights inside the text element. */
export function textOffset(el: HTMLElement, node: Node, at: number): number | null {
  if (!el.contains(node)) return null;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.setEnd(node, at);
  return range.toString().length;
}

export function selectedSplit(sel: Selection | null, segments: readonly SegmentView[]): SplitPoint | null {
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el = ("closest" in node ? node as Element : node.parentElement)?.closest<HTMLElement>(".cw-seg__text");
  const id = el?.closest<HTMLElement>("[data-segment-id]")?.dataset.segmentId;
  const seg = segments.find((s) => s.id === id && s.state === "confirmed");
  if (!seg || !el || !el.contains(range.endContainer)) return null;
  const at = textOffset(el, node, range.startOffset);
  return at !== null && splitAt(seg.text, at) ? { seg, at, anchor: el } : null;
}

export function pointedWord(el: HTMLElement, text: string, x: number, y: number): TextRange | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const doc = el.ownerDocument;
  const position = doc.caretPositionFromPoint?.(x, y);
  const range = position ? null : doc.caretRangeFromPoint?.(x, y);
  const at = position ? textOffset(el, position.offsetNode, position.offset)
    : range ? textOffset(el, range.startContainer, range.startOffset) : null;
  return at === null ? null : wordAt(text, at);
}


/** The native Edit item follows the window's current caret or selection. */
export function watchSplitMenu(
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "hasFocus">,
  window: Pick<Window, "addEventListener" | "removeEventListener">,
  pick: () => SplitPoint | null,
  setEnabled: (enabled: boolean) => void,
  listen: (handler: (key: string) => void) => Promise<() => void>,
  open: (point: SplitPoint) => void,
): () => void {
  const update = () => setEnabled(doc.hasFocus() && !!pick());
  const blur = () => setEnabled(false);
  let mounted = true;
  const listening = listen((key) => {
    if (!mounted || key !== "menu.split_line") return;
    const point = pick();
    if (point) open(point);
  });
  doc.addEventListener("selectionchange", update);
  window.addEventListener("focus", update);
  window.addEventListener("blur", blur);
  update();
  return () => {
    mounted = false;
    void listening.then((unlisten) => unlisten());
    doc.removeEventListener("selectionchange", update);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", blur);
    blur();
  };
}
