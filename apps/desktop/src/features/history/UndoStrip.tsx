// undo-strip (prototype C.undoStrip): the message, Undo or Redo for the same core target, and ×. It never takes
// focus; ⌘Z and ⇧⌘Z run its action while it is shown, except in a text field (native text undo).
import { useEffect, type FocusEvent, type KeyboardEvent } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { isTyping } from "../../app/a11y/keys";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { PushButton } from "../../ui/primitives/push-button";
import "../../styles/components";
import { dismissUndo, holdPointer, runUndo, useUndo, type UndoEntry } from "./undo";

/** ⌘Z while the strip offers Undo, ⇧⌘Z while it offers Redo; true when the key is for the strip. */
export const undoKey = (e: { code: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }, entry: UndoEntry | null) =>
  !!entry && e.code === "KeyZ" && e.metaKey && !e.altKey && !e.ctrlKey && e.shiftKey === (entry.mode === "redo");

// @cpt-component:cpt-noter-component-ui-undo-strip:p1
export function UndoStrip({ bridge }: { bridge: Bridge }) {
  const entry = useUndo();
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-return
      if (!undoKey(e, entry) || isTyping(e.target) || e.repeat) return;
      e.preventDefault();
      void runUndo(bridge);
      // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-return
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [bridge, entry]);
  if (!entry) return null;
  const label = t(entry.mode === "undo" ? "undo.undo" : "undo.redo");
  return (
    <div
      data-component="cpt-noter-component-ui-undo-strip"
      data-variant={entry.mode === "undo" ? "after-action" : "after-undo"}
      data-state={entry.phase.toLowerCase()}
      className="np-undo"
      role="status"
      onPointerEnter={() => holdPointer("hover", true)}
      onPointerLeave={() => holdPointer("hover", false)}
      onFocus={() => holdPointer("focus", true)}
      onBlur={(e: FocusEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && holdPointer("focus", false)}
      onKeyDown={(e: KeyboardEvent) => e.key === "Escape" && dismissUndo()}
    >
      <div className="np-undo__text">
        <div className="np-undo__msg">{entry.message}</div>
        {entry.context && <div className="np-undo__ctx">{entry.context}</div>}
      </div>
      <PushButton label={label} size="small" loading={entry.phase === "WORKING"} onAction={() => void runUndo(bridge)} />
      <IconButton icon="x" label={t("undo.dismiss")} size="inline" onAction={dismissUndo} />
    </div>
  );
}
