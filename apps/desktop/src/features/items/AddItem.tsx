// **Add Action Item**: a field under the action items list; Return or Add creates an accepted item (`item_create`).
import { useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { addItem } from "./actions";

// @cpt-flow:cpt-noter-flow-ui-items-status:p1
export function AddItem({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const close = () => (setText(null), setError(null));
  const add = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const err = await addItem(bridge, callId, text ?? "");
      if (err) return setError(err);
      close();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  if (text === null) return <PushButton label={t("items.add")} size="small" variant="quiet" icon="plus" onAction={() => setText("")} />;
  return (
    <div className="it-add" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}>
      <TextField value={text} disabled={busy} placeholder={t("items.add_prompt")} ariaLabel={t("items.add_prompt")} invalid={!!error} message={error ?? undefined} onChange={setText} onEnter={() => void add()} />
      <PushButton label={t("items.add_confirm")} size="small" variant="primary" loading={busy} onAction={() => void add()} />
    </div>
  );
}
