import { useState } from "react";
import { t } from "../../i18n/format";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import { checkTag } from "./tags";

/** Add Tag… for the selected calls: Return, comma or Add Tag commits; a refused tag keeps the draft and says why. */
export function AddTagPopover({ anchor, count, inUse, onAdd, onClose }: { anchor: HTMLElement | null; count: number; inUse: string[]; onAdd: (tag: string) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commit = async (text: string) => {
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-commit-tag
    const c = checkTag(text);
    if ("error" in c) return setError(t(c.error));
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-commit-tag
    // the draft stays when the write fails, for an explicit retry
    if (await onAdd(c.tag)) onClose();
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-if-write-fails
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tag-error
    else setError(t("tags.failed"));
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tag-error
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-if-write-fails
  };
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-add-popover
  return (
    <Popover variant="add-tag" anchor={anchor} width={300} label={t("tags.add_to", { count })} onClose={onClose}>
      <div className="lb-pop">
        <strong>{t("tags.add_to", { count })}</strong>
        <SearchField variant="token-field" placeholder={t("tags.add")} value={draft} invalid={!!error} onChange={(v) => (setDraft(v), setError(null))} onAddToken={(v) => void commit(v)} />
        {error && <span role="alert">{error}</span>}
        {inUse.length > 0 && <span>{t("tags.in_use", { tags: inUse.join(", ") })}</span>}
        <PushButton label={t("tags.add_button")} variant="primary" onAction={() => void commit(draft)} />
      </div>
    </Popover>
  );
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-add-popover
}
