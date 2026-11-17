import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { loadTags } from "../call-page/share-actions";
import { apply, heldFilter, holdFilter } from "./filters";

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-suggest
/** `#release` typed or picked from the suggestions names a tag in use: that tag, else null (a `#` word of its own stays a search). */
export function tagChoice(text: string, tags: string[]): string | null {
  const m = /^#(\S+)$/.exec(text.trim());
  return (m && tags.find((x) => x.toLowerCase() === m[1]!.toLowerCase())) || null;
}

/** A chosen tag (picked from the list, or an exact `#tag` on Return) adds the tag filter once; the caller clears the draft. */
export const holdTag = (tag: string): void => holdFilter(apply(heldFilter(), { type: "add", group: "tags", value: tag }));

/** ↑ ↓ move the active row of the list (wrapping), Return picks the active one; null leaves the key to the field. */
export function listKey(key: string, active: number, count: number): { active: number; pick?: number } | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return { active: (active + 1) % count };
  if (key === "ArrowUp") return { active: active <= 0 || active >= count ? count - 1 : active - 1 };
  return key === "Enter" && active >= 0 && active < count ? { active, pick: active } : null;
}

/** The tags the list under the field offers for what is typed: while it starts with `#`, those containing the rest. */
export function tagMatches(text: string, tags: string[], limit = 8): string[] {
  if (!text.startsWith("#")) return [];
  const q = text.slice(1).toLowerCase();
  return tags.filter((x) => x.toLowerCase().includes(q)).slice(0, limit);
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-suggest

/** The tags in use, read after the window snapshot; none when the read fails. */
// @cpt-algo:cpt-noter-algo-ui-library-search-topics-filters:p1
export function useTagChoices(bridge: Bridge): string[] {
  const [tags, setTags] = useState<string[]>([]);
  const ready = useWindow(bridge, (s) => s.app !== null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void loadTags(bridge).then((r) => live && setTags(r.status === "ok" ? r.data.tags.map((x) => x.tag) : []));
    return () => void (live = false);
  }, [bridge, ready]);
  return tags;
}
