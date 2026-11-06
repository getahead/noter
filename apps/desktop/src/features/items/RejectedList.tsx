// **Rejected (n)** under an item section: the rejected items folded away, each with **Restore**. The core keeps them
// suppressed on regeneration; Restore returns one to Suggested.
import { useState } from "react";

import { useWindow } from "../../app/use-window";
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Disclosure } from "../../ui/primitives/disclosure";
import { PushButton } from "../../ui/primitives/push-button";
import { review } from "./actions";
import { useLocals } from "./local";
import { langOf } from "./review";
import "./items.css";

export function RejectedList({ bridge, items }: { bridge: Bridge; items: ItemView[] }) {
  const [open, setOpen] = useState(false);
  const locals = useLocals();
  const held = useWindow(bridge, (s) => s.entities.item);
  // a row still showing its **Rejected · Undo** outcome is not folded in yet; the store knows a review the section has not been re-read for
  const rows = items.map((i) => (held[i.id] && held[i.id]!.rev > i.rev ? held[i.id]! : i)).filter((i) => i.review === "rejected" && !locals.get(i.id)?.outcome);
  if (!rows.length) return null;
  return (
    <div className="it-rejected">
      <Disclosure label={t("items.rejected_n", { count: rows.length })} open={open} variant="row" onAction={() => setOpen(!open)} />
      {rows.map((i) => locals.get(i.id)?.error && <span key={i.id} className="it-row__error" role="alert">{locals.get(i.id)!.error}</span>)}
      {open && (
        <ul className="it-rejected__list">
          {rows.map((i) => (
            <li key={i.id} lang={langOf(i.lang)}>
              <span className="it-row__ghost is-rej">{i.text}</span>
              <PushButton label={t("items.restore")} size="small" onAction={() => void review(bridge, i, "restore")} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
