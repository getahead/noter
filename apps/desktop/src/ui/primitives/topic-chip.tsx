import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface TopicChipProps extends Common {
  name: string;
  /** The counts as the host formats them ("6 calls · 3 decisions"); the host decides which to show. */
  counts?: string;
  /** The core suggests merging this topic with another; the host's words for it, read with the name. */
  merge?: string;
  /** inline (22 pt, item rows) or suggestion (28 pt, search results). */
  size?: "inline" | "suggestion";
  /** Opens the Topic thread; without it the chip is plain text (read-only rows). */
  onOpen?: () => void;
}

// @cpt-component:cpt-noter-component-ui-topic-chip:p1
/** topic-chip: a glyph, the name, optional counts and a merge glyph; it is the one link into a thread. */
export function TopicChip({ name, counts, merge, size = "inline", onOpen, ...o }: TopicChipProps) {
  const body = (
    <>
      <Icon name="thread" size={11} />
      <span className="np-topic__name">{name}</span>
      {counts && <span className="np-dim">{counts}</span>}
      {merge && <Icon name="merge" size={11} cls="np-topic__merge" />}
    </>
  );
  const cls = cx("np-topic", size === "suggestion" ? "np-topic--suggestion" : "np-topic--inline", o.cls);
  const attrs = base("topic-chip", { ...o, variant: counts ? "counts" : "name" });
  return onOpen ? (
    <button type="button" className={cls} {...attrs} aria-description={merge} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <span className={cls} {...attrs}>
      {body}
    </span>
  );
}
