// Source details: name, schedule and privacy are editable; mode and location are shown, not changed (the contract
// cannot change them). A refused save keeps the draft; a revision conflict refreshes the list and asks for a new save.
import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { PrivacyClass, SourceRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { useAlert } from "../../ui/dialogs/host";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { TextField } from "../../ui/primitives/text-field";
import { PRIVACY_CHOICES } from "./SourceFormSheet";
import { ScopeFields, useCallTypes, usePeople } from "./ScopeFields";
import { draftChanged, draftOf, rebaseDraft, removeAlert, removeSource, revokeAlert, revokeToken, scopeValid, updateSource } from "./sources";

type Ask = (a: ReturnType<typeof removeAlert>) => Promise<boolean>;

// @cpt-state:cpt-noter-state-ui-privacy-sources-view:p1
export function SourceDetailsSheet({ bridge, row, onRefresh, onClose, ask }: { bridge: Bridge; row: SourceRow; onRefresh: () => void; onClose: () => void; ask?: Ask }) {
  const confirm = useAlert();
  const asker = ask ?? confirm;
  const [draft, setDraft] = useState(draftOf(row));
  const [base, setBase] = useState(row);
  // the row follows the core's entity events: keep the user's edits, adopt the current values for the rest
  useEffect(() => {
    if (row.rev === base.rev) return;
    setDraft((d) => rebaseDraft(base, d, row));
    setBase(row);
  }, [row, base]);
  const types = useCallTypes(bridge);
  const people = usePeople(bridge);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const working = busy || row.status.type === "indexing";
  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await f(); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const r = await updateSource(bridge, row, draft, base);
    if (r.ok) return onClose();
    if ("conflict" in r) { onRefresh(); return setMessage(t("sources.conflict")); }
    setMessage(t("sources.error_save"));
  });
  const revoke = () => run(async () => {
    if (!(await asker(revokeAlert(row)))) return;
    if (!(await revokeToken(bridge, row.id))) setMessage(t("sources.error_revoke"));
  });
  const remove = () => run(async () => {
    if (!(await asker(removeAlert(row)))) return;
    if (await removeSource(bridge, row.id)) { onRefresh(); onClose(); } else setMessage(t("sources.error_remove"));
  });
  return (
    <Sheet title={t("sources.details_title", { name: row.name })} width={520} busy={busy} onCancel={onClose} onDefault={() => void save()}>
      <div className="np-sheet__head"><div className="np-sheet__title">{t("sources.details_title", { name: row.name })}</div></div>
      <div className="np-sheet__body">
        <TextField id="src-name" label={t("sources.name")} showLabel value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <p className="np-dim">{row.kind === "folder" ? t("sources.location", { where: row.location }) : t("sources.server_is", { where: row.location })} · {row.mode === "live" ? t("sources.mode_live") : t("sources.mode_indexed")}</p>
        {row.mode === "indexed" && row.kind === "mcp" && (<>
          <label className="st-row__label" htmlFor="src-d-schedule">{t("sources.schedule")}</label>
          <PopupButton id="src-d-schedule" label={t("sources.schedule")} options={[{ value: "hourly", label: t("sources.schedule_hourly") }, { value: "daily", label: t("sources.schedule_daily") }]} value={draft.schedule ?? "daily"} onAction={(schedule) => setDraft({ ...draft, schedule })} />
        </>)}
        <label className="st-row__label" htmlFor="src-d-privacy">{t("sources.privacy")}</label>
        <PopupButton id="src-d-privacy" label={t("sources.privacy")} options={PRIVACY_CHOICES()} value={draft.privacy} onAction={(v) => setDraft({ ...draft, privacy: v as PrivacyClass })} />
        <ScopeFields bridge={bridge} types={types} people={people} value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
        <p className="np-dim">{row.has_token ? t("sources.token_present") : t("sources.token_absent")}</p>
        {message && <p className="hd__err" role="alert">{message}</p>}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("sources.save")} variant="primary" disabled={busy || !draftChanged(row, draft) || !draft.name.trim() || !scopeValid(draft.scope)} onAction={() => void save()} />}>
        <PushButton label={t("sources.remove")} disabled={working} onAction={() => void remove()} />
        {row.has_token && <PushButton label={t("sources.revoke")} disabled={working} onAction={() => void revoke()} />}
        <span className="np-tb__spacer" />
        <PushButton label={t("dialogs.cancel")} onAction={onClose} />
      </SheetFooter>
    </Sheet>
  );
}
