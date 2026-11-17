// **Add MCP Server** (`dlg-mcp`): Server, Mode, Schedule and Privacy class, with what Live and Indexed mean shown
// before the user confirms. A duplicate or missing server is a field error and the draft stays.
import { useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { PrivacyClass, SourceMode } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { TextField } from "../../ui/primitives/text-field";
import { PRIVACY_CHOICES } from "./SourceFormSheet";
import { ScopeFields, useCallTypes, usePeople } from "./ScopeFields";
import { ALL_SCOPE, scheduleChoices, submitMcp, type ScopeDraft } from "./sources";


export function AddMcpSourceSheet({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  const [server, setServer] = useState("");
  const [mode, setMode] = useState<SourceMode>("indexed");
  const [schedule, setSchedule] = useState("daily");
  const [privacy, setPrivacy] = useState<PrivacyClass>("normal");
  const [scope, setScope] = useState<ScopeDraft>(ALL_SCOPE);
  const types = useCallTypes(bridge);
  const people = usePeople(bridge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await submitMcp(bridge, { server, mode, schedule, privacy, scope });
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };
  return (
    <Sheet title={t("sources.add_mcp_title")} width={520} busy={busy} onCancel={onClose} onDefault={() => void add()}>
      <div className="np-sheet__head"><div className="np-sheet__title">{t("sources.add_mcp_title")}</div></div>
      <div className="np-sheet__body">
        <TextField id="src-server" label={t("sources.server")} showLabel value={server} placeholder={t("sources.server_placeholder")} invalid={!!error} message={error ?? undefined} onChange={setServer} onEnter={() => void add()} />
        <label className="st-row__label" htmlFor="src-mode">{t("sources.mode")}</label>
        <PopupButton id="src-mode" label={t("sources.mode")} options={[{ value: "indexed", label: t("sources.mode_indexed") }, { value: "live", label: t("sources.mode_live") }]} value={mode} onAction={(v) => setMode(v as SourceMode)} />
        <p className="np-dim">{mode === "live" ? t("sources.mode_live_note") : t("sources.mode_indexed_note")}</p>
        {mode === "indexed" && (<>
          <label className="st-row__label" htmlFor="src-schedule">{t("sources.schedule")}</label>
          <PopupButton id="src-schedule" label={t("sources.schedule")} options={scheduleChoices()} value={schedule} onAction={setSchedule} />
        </>)}
        <label className="st-row__label" htmlFor="src-mcp-privacy">{t("sources.privacy")}</label>
        <PopupButton id="src-mcp-privacy" label={t("sources.privacy")} options={PRIVACY_CHOICES()} value={privacy} onAction={(v) => setPrivacy(v as PrivacyClass)} />
        <p className="np-dim">{privacy === "sensitive" ? t("sources.privacy_sensitive_note") : t("sources.privacy_normal_note")}</p>
        <p className="np-dim">{t("sources.scope_all")}</p>
      </div>
      <SheetFooter defaultButton={<PushButton label={t("sources.add_source")} variant="primary" disabled={busy} onAction={() => void add()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={onClose} />
      </SheetFooter>
    </Sheet>
  );
}
