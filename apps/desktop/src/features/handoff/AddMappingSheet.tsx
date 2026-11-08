// Choosing a folder is part of repo_upsert: a successful Choose saves and closes; cancellation keeps the draft.
import { useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { HandoffTarget, RepoMapping } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { TextField } from "../../ui/primitives/text-field";
import { toolLabel } from "./controls";
import { initialMapping, mappingArgs, mappingError, saveRepo } from "./mappings";
import "./handoff.css";

export interface AddMappingProps { bridge: Bridge; sourceKey?: string; mapping?: RepoMapping; fromHandoff?: boolean; returnFocus?: () => void; close: () => void; onSaved?: () => Promise<void> | void }

// @cpt-dod:cpt-noter-dod-ui-handoff-mappings:p1
// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-sheet
export function AddMappingSheet({ bridge, sourceKey, mapping, fromHandoff, returnFocus, close, onSaved }: AddMappingProps) {
  const [draft, setDraft] = useState(() => initialMapping(sourceKey, mapping));
  const [error, setError] = useState<ReturnType<typeof mappingError>>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const title = t(mapping ? "mapping.edit" : "mapping.add");
  const save = async (picker: boolean) => {
    const args = mappingArgs(draft, picker);
    if (!args || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRepo(bridge, args);
      if (result.status === "error") return void setError(mappingError(result.error.code));
      await onSaved?.();
      close();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  // the Sheet primitive refocuses what was focused before it opened, so the opener takes focus after that (DESIGN › Focus order)
  const cancel = () => { if (saving.current) return; close(); if (returnFocus) requestAnimationFrame(returnFocus); };
  return (
    <Sheet title={title} width={520} busy={busy} onCancel={cancel} onDefault={() => void save(false)}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{title}</div>
        {fromHandoff && <div className="np-sheet__sub">{t("mapping.from_handoff")}</div>}
      </div>
      <div className="np-sheet__body hd-mapping">
        <TextField label={t("mapping.key")} showLabel placeholder={t("mapping.key_placeholder")} value={draft.key} disabled={busy} invalid={error?.field === "key"} message={error?.message} onChange={(key) => { setDraft({ ...draft, key }); setError(null); }} />
        <div className="hd-mapping__folder">
          <TextField label={t("mapping.folder")} showLabel mono value={draft.path} disabled={busy} invalid={error?.field === "path"} message={error?.message} onChange={(path) => { setDraft({ ...draft, path }); setError(null); }} />
          <PushButton label={t("mapping.choose")} disabled={busy || !mappingArgs(draft, true)} onAction={() => save(true)} />
        </div>
        <div className="hd-mapping__tool">
          <span>{t("mapping.tool")}</span>
          <SegmentedControl label={t("mapping.tool")} value={draft.target} items={(["claude_code", "codex"] as const).map((value) => ({ value, label: toolLabel(value), disabled: busy }))} onAction={(target) => setDraft({ ...draft, target: target as HandoffTarget })} />
        </div>
        {error?.field === "form" && <p className="hd__err" role="alert">{error.message}</p>}
      </div>
      <SheetFooter defaultButton={<PushButton label={t(mapping ? "mapping.save" : "mapping.add")} variant="primary" disabled={busy || !mappingArgs(draft, false)} loading={busy} onAction={() => save(false)} />}>
        <PushButton label={t("dialogs.cancel")} disabled={busy} onAction={cancel} />
      </SheetFooter>
    </Sheet>
  );
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-sheet
