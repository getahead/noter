// FP-R1 overflow (#1186, coordinator decision under the owner's delegation): the floating panel's title keeps at least
// 8 em. When the header can't give it that (Text size up to 150 % in a narrow panel), icon controls move into ⋯ More,
// one at a time, in a fixed order: Move to Display 2, then Collapse, then the shield. Hide for Presenting, More and ×
// never move, and neither does the clock.
import { useEffect, useState, type RefObject } from "react";

export type FoldItem = "move" | "collapse" | "shield";

/** The controls that can move, in the order they move; Move to Display 2 only when there are two displays. */
export const foldOrder = (twoDisplays: boolean): FoldItem[] => (twoDisplays ? ["move", "collapse", "shield"] : ["collapse", "shield"]);

/** Title width the header must leave, in em. */
export const TITLE_MIN_EM = 8;
/** Room one returning control needs, in em (a 22-pt inline button and its gap, plus slack so the header never flaps). */
const UNFOLD_EM = 3;

/** One step of the rule: fold one more control while the title is under its minimum; unfold one when there is room for it. */
export function nextFold(fold: number, max: number, titleWidth: number, em: number): number {
  if (titleWidth < TITLE_MIN_EM * em && fold < max) return fold + 1;
  if (fold > 0 && titleWidth >= (TITLE_MIN_EM + UNFOLD_EM) * em) return fold - 1;
  return fold;
}

/** How many controls are folded into More, measured from the title's width as the header resizes. */
export function useHeaderFold(title: RefObject<HTMLElement | null>, max: number, deps: readonly unknown[]): number {
  const [fold, setFold] = useState(0);
  useEffect(() => {
    const el = title.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const em = parseFloat(getComputedStyle(el).fontSize) || 13;
      setFold((f) => nextFold(Math.min(f, max), max, el.clientWidth, em));
    };
    check();
    const ro = new ResizeObserver(check);
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, max, fold, ...deps]);
  return Math.min(fold, max);
}
