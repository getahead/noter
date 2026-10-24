// Follow output and the virtualised window of the transcript log: pure, so the view's scroll handler and layout
// effect stay one-liners over these.

export interface Follow {
  following: boolean;
  /** The confirmed-row count when the view detached; new lines are counted from it. */
  base: number;
}

export interface ScrollPos {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** At the end: within one row of the bottom. */
export const atEnd = (p: ScrollPos, row: number) => p.scrollHeight - p.scrollTop - p.clientHeight <= row;

// @cpt-algo:cpt-noter-algo-ui-live-transcript-follow-output:p1
/**
 * A scroll of the log: within one row of the end it follows; any step up away from the very end detaches at once (an
 * animated wheel's first frame is still within one row, and a flush that kept the end would undo it) and counts new
 * confirmed rows from now; a smooth scroll on its way down leaves it as it was.
 */
export function onScroll(f: Follow, p: ScrollPos, prevTop: number, row: number, confirmed: number): Follow {
  const up = p.scrollTop < prevTop && !atEnd(p, 1); // a log shortened by a correction clamps up to the very end: not the user
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-if-end
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-return-following
  if (!up && atEnd(p, row)) return f.following ? f : { following: true, base: confirmed };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-return-following
  // @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-if-end
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-return-detached
  if (f.following && up) return { following: false, base: confirmed };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-return-detached
  return f;
}

// @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-count
/** The pill's count: confirmed rows added since the view detached. */
export const newLines = (f: Follow, confirmed: number) => (f.following ? 0 : Math.max(0, confirmed - f.base));
// @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-count

export interface Window {
  start: number;
  end: number;
  /** Space above the first drawn row and below the last, in px. */
  before: number;
  after: number;
}

export type ViewState = "LOADING" | "WAITING_FOR_SPEECH" | "FOLLOWING" | "DETACHED" | "FIND_ACTIVE" | "ERROR";

// @cpt-state:cpt-noter-state-ui-live-transcript-view:p1
/** The view's state from the Channel's slice, the follow state and the find bar. */
export function viewState(s: { error: boolean; loaded: boolean; waiting: boolean; follow: Follow; find: boolean }): ViewState {
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-error
  if (s.error) return "ERROR";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-error
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-error-loading
  if (!s.loaded) return "LOADING";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-error-loading
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-waiting
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-following-waiting
  if (s.waiting) return "WAITING_FOR_SPEECH";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-following-waiting
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-waiting
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-following-find
  if (s.find) return "FIND_ACTIVE";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-following-find
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-following-detached
  if (!s.follow.following) return "DETACHED";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-following-detached
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-following
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-waiting-following
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-detached-following
  // @cpt-begin:cpt-noter-state-ui-live-transcript-view:p1:inst-find-following
  return "FOLLOWING";
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-find-following
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-detached-following
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-waiting-following
  // @cpt-end:cpt-noter-state-ui-live-transcript-view:p1:inst-loading-following
}

/** The measured height of each drawn row (children of the list, in order from `start`), and how far the rows above
 *  the scroll position grew: the view scrolls by that much so the rows in view never move. */
export function measure(nodes: ArrayLike<{ offsetHeight: number; offsetTop: number }>, keys: readonly string[], start: number, heights: Map<string, number>, est: number, scrollTop: number): { changed: boolean; shift: number } {
  let changed = false;
  let shift = 0;
  for (let i = 0; i < nodes.length; i++) {
    const key = keys[start + i];
    const h = nodes[i]!.offsetHeight;
    if (key === undefined || !h) continue;
    const old = heights.get(key) ?? est;
    if (h === old) continue;
    heights.set(key, h);
    changed = true;
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-no-jump
    if (nodes[i]!.offsetTop + h <= scrollTop) shift += h - old;
    // @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-no-jump
  }
  return { changed, shift };
}

/** The rows to draw: those in view plus `overscan` on each side; the rest are spacers of their known or estimated height. */
export function windowOf(heights: readonly number[], scrollTop: number, viewport: number, overscan: number): Window {
  let y = 0;
  let start = 0;
  while (start < heights.length && y + heights[start]! <= scrollTop) y += heights[start++]!;
  let end = start;
  let bottom = y;
  while (end < heights.length && bottom < scrollTop + viewport) bottom += heights[end++]!;
  const from = Math.max(0, start - overscan);
  const to = Math.min(heights.length, end + overscan);
  let before = 0;
  for (let i = 0; i < from; i++) before += heights[i]!;
  let after = 0;
  for (let i = to; i < heights.length; i++) after += heights[i]!;
  return { start: from, end: to, before, after };
}

/** The parts of the scroll area and its list the log reads and moves (an HTMLElement in the view). */
export interface ScrollArea extends ScrollPos {
  scrollTo(o: { top: number; behavior: ScrollBehavior }): void;
}
export interface RowList {
  children: ArrayLike<{ offsetHeight: number; offsetTop: number; focus?(o: { preventScroll: boolean }): void }>;
}

export const OVERSCAN = 8;

/** The view's scroll bookkeeping: row heights by key, the last scroll position and the row waiting for focus. */
export class LogScroller {
  readonly heights = new Map<string, number>();
  prevTop = -1;
  focusKey: string | null = null;
  constructor(readonly est: number) {}

  sizes(keys: readonly string[]): number[] {
    return keys.map((k) => this.heights.get(k) ?? this.est);
  }

  /** The window of rows to draw for a scroll position. */
  window(keys: readonly string[], scrollTop: number, viewport: number): Window {
    return windowOf(this.sizes(keys), scrollTop, viewport, OVERSCAN);
  }

  /**
   * After a render: measure the drawn rows, keep the end in view while following (a jump for the first draw and for
   * corrections), otherwise keep the rows in view where they were; focus a waiting row. Returns whether to redraw.
   */
  afterRender(el: ScrollArea, ul: RowList, keys: readonly string[], follow: boolean, behavior: ScrollBehavior): boolean {
    const start = this.window(keys, el.scrollTop, el.clientHeight).start;
    const m = measure(ul.children, keys, start, this.heights, this.est, el.scrollTop);
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-keep-end
    if (follow) el.scrollTo({ top: el.scrollHeight, behavior: m.changed || this.prevTop < 0 ? "instant" : behavior });
    // @cpt-end:cpt-noter-algo-ui-live-transcript-follow-output:p1:inst-keep-end
    else if (m.shift) el.scrollTo({ top: el.scrollTop + m.shift, behavior: "instant" });
    if (this.focusKey) {
      const row = ul.children[keys.indexOf(this.focusKey) - start];
      row?.focus?.({ preventScroll: true });
      if (row) this.focusKey = null;
    }
    return m.changed;
  }

  /** Scroll a row to a third of the way down the view (evidence, the current find match). */
  scrollToRow(el: ScrollArea, keys: readonly string[], key: string, behavior: ScrollBehavior): void {
    const i = keys.indexOf(key);
    if (i < 0) return;
    const top = this.sizes(keys.slice(0, i)).reduce((y, h) => y + h, 0);
    el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior });
  }

  /** A scroll event: the follow state it leads to, from the position before it. */
  scrolled(f: Follow, el: ScrollPos, confirmed: number): Follow {
    const next = onScroll(f, el, this.prevTop, this.est, confirmed);
    this.prevTop = el.scrollTop;
    return next;
  }
}
