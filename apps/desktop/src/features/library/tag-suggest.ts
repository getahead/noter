import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { loadTags } from "../call-page/share-actions";
import { apply, heldFilter, holdFilter } from "./filters";

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-suggest
/** `#release` typed or picked from the suggestions names a tag in use: that tag, else null (a `#` word of its own stays a search). */
export function tagChoice(text: string, tags: string[]): string | null {
  const m = /^#(\S+)$/.exec(text.trim());
  return (m && tags.find((x) => x.toLowerCase() === m[1]!.toLowerCase())) || null;
}

/** A tag choice adds the tag filter once and the caller clears the draft; returns whether it was a choice. */
export function takeTag(text: string, tags: string[]): boolean {
  const tag = tagChoice(text, tags);
  if (tag) holdFilter(apply(heldFilter(), { type: "add", group: "tags", value: tag }));
  return tag !== null;
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-suggest

/** The tags in use, read once when the window opens; none when the read fails. */
export function useTagChoices(bridge: Bridge): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void loadTags(bridge).then((r) => live && setTags(r.status === "ok" ? r.data.tags.map((x) => x.tag) : []));
    return () => void (live = false);
  }, [bridge]);
  return tags;
}
