// **Add Action Item**: a field under the action items list; Return or Add creates an accepted item (`item_create`).
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { loadOutputs } from "../call-page/outputs-actions";
import { create, errorText } from "./actions";

export function AddItem({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => (setText(null), setError(null));
  const add = async () => {
    const res = await create(bridge, callId, text ?? "");
    if (!res) return setError(errorText("invalid_input"));
    if (res.status !== "ok") return setError(errorText(res.error.code)); // the text stays for another try
    close();
    await loadOutputs(bridge, callId); // the section lists the new row
  };
  if (text === null) return <PushButton label={t("items.add")} size="small" variant="quiet" icon="plus" onAction={() => setText("")} />;
  return (
    <div className="it-add" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}>
      <TextField value={text} placeholder={t("items.add_prompt")} ariaLabel={t("items.add_prompt")} invalid={!!error} message={error ?? undefined} onChange={setText} onEnter={() => void add()} />
      <PushButton label={t("items.add_confirm")} size="small" variant="primary" onAction={() => void add()} />
    </div>
  );
}
