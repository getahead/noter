// One recent question (AK-R2): click opens it, right-click or ⋯ offers Copy Question and Delete.
import { useState } from "react";

import type { AskThreadRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { rowId } from "./actions";
import { Menu } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";

export function RecentRow({ row, selected, onOpen, onCopy, onDelete }: { row: AskThreadRow; selected: boolean; onOpen: () => void; onCopy: () => void; onDelete: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <li className="ak-recent__li">
      <button
        type="button"
        id={rowId(row.id)}
        className={`ak-recent__item${selected ? " is-sel" : ""}`}
        aria-current={selected}
        title={row.title}
        onClick={onOpen}
        onContextMenu={(e) => (e.preventDefault(), setAnchor(e.currentTarget))}
        onKeyDown={(e) => e.key === "ContextMenu" && setAnchor(e.currentTarget)}
      >
        {row.title}
      </button>
      {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-manage */}
      {anchor && (
        <Popover variant="ask-row-menu" anchor={anchor} align="start" label={t("ask.row_menu")} onClose={close}>
      {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-manage */}
          <Menu
            variant="context-menu"
            label={t("ask.row_menu")}
            onClose={close}
            items={[
              { label: t("ask.copy_question"), onSelect: () => (onCopy(), close()) },
              { divider: true },
              { label: t("ask.delete"), destructive: true, onSelect: () => (onDelete(), close()) },
            ]}
          />
        </Popover>
      )}
    </li>
  );
}
