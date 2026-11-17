import type { Bridge } from "../../app/bridge/bridge";
import { applyRecord } from "../../app/store/window-store";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";

export const MAX_TAG = 32;

/** The typed tag, or why it cannot be one: blank or over 32 characters is refused, never trimmed or truncated silently. */
export function checkTag(text: string): { tag: string } | { error: "tags.empty" | "tags.long" } {
  const tag = text.trim();
  return !tag ? { error: "tags.empty" } : [...tag].length > MAX_TAG ? { error: "tags.long" } : { tag };
}

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tags-set
/** `call_tags_set` for the selected calls: rows replace from the response, the strip gets the batch (or the one change). */
export async function tagCalls(bridge: Bridge, ids: string[], add: string[], remove: string[]) {
  const r = await bridge.act("library:tags", "call_tags_set", () => bridge.core.callTagsSet({ call_ids: ids, add, remove }));
  if (r.status !== "ok") return r;
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tags-set
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tag-result
  const message = add.length ? t("tags.tagged_n", { count: ids.length, tag: add[0]! }) : t("tags.removed_n", { count: ids.length, tag: remove[0]! });
  holdUndo({ target: r.data.batch_id ? { type: "batch", batch_id: r.data.batch_id } : { type: "change", change_id: r.data.change_id }, message });
  r.data.calls.forEach((call) => bridge.store.setState((st) => applyRecord(st, "call", { call })));
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tag-result
  return r;
}
