// **Regenerate Outputs…** (sheet `regenerate`): which runtime, skill and sections the core writes again. The user's edits
// are kept and shown as a diff, so the sheet only says so.
import { useEffect, useState } from "react";

import type { MsgKey } from "../../i18n/en";
import type { Bridge } from "../../app/bridge/bridge";
import type { RuntimeChoice, SectionKind } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { useSheetIfAny } from "../../ui/dialogs/host";
import type { SheetProps } from "../../ui/dialogs/sheets";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { useTypes } from "./cache";
import { regenerate } from "./outputs-actions";
import { loadOutputs } from "./outputs-actions";

// DESIGN: Summary, "Decisions, action items and open questions" (both on) and Role reviews (off)
const GROUPS: ReadonlyArray<{ id: string; label: MsgKey; kinds: SectionKind[] }> = [
  { id: "summary", label: "outputs.section.summary", kinds: ["summary"] },
  { id: "items", label: "outputs.regen.items", kinds: ["decisions", "action_items", "open_questions"] },
  { id: "role_reviews", label: "outputs.section.role_reviews", kinds: ["role_reviews"] },
];
// shortcut: the models are DESIGN's static list; read them from the runtime's own list when the core has one
const RUNTIMES: ReadonlyArray<{ value: string; label: MsgKey; runtime: RuntimeChoice; model: string }> = [
  { value: "sonnet", label: "outputs.regen.sonnet", runtime: "claude_api_key", model: "claude-sonnet" },
  { value: "opus", label: "outputs.regen.opus", runtime: "claude_api_key", model: "claude-opus" },
  { value: "codex", label: "outputs.regen.codex", runtime: "codex_api_key", model: "gpt-5-codex" },
  { value: "local", label: "outputs.regen.local", runtime: "local", model: "qwen3-14b" },
];

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-regenerate:p1
export function RegenerateSheet({ close, bridge, callId, sections }: SheetProps & { bridge: Bridge; callId: string; sections: SectionKind[] }) {
  const types = useTypes();
  const [runtime, setRuntime] = useState("current");
  const [skill, setSkill] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(GROUPS.filter((g) => g.id !== "role_reviews" && g.kinds.some((k) => sections.includes(k) || g.id === "items")).map((g) => g.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-call
    if (busy || picked.size === 0) return;
    setBusy(true);
    const chosen = RUNTIMES.find((x) => x.value === runtime);
    const r = await regenerate(bridge, { call_id: callId, sections: GROUPS.filter((g) => picked.has(g.id)).flatMap((g) => g.kinds), runtime: chosen?.runtime ?? null, model: chosen?.model ?? null, skill: skill || null, local: runtime === "local" });
    setBusy(false);
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-call
    if (r.status === "error") return setError(r.error.code === "job_blocked" ? t("outputs.regen.blocked") : t("outputs.regen.failed"));
    close();
    void loadOutputs(bridge, callId);
  };

  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-sheet
  return (
    <Sheet title={t("outputs.regen.title")} width={520} busy={busy} onCancel={close} onDefault={() => void submit()}>
      <div className="np-sheet__head"><div className="np-sheet__title">{t("outputs.regen.title")}</div></div>
      <div className="np-sheet__body pc-regen">
        {error && <InlineBanner banner={{ id: "regen-error", severity: "error", text: error }} />}
        <label className="pc-regen__row">{t("outputs.regen.runtime")}
          <PopupButton label={t("outputs.regen.runtime")} value={runtime} onAction={setRuntime} options={[{ value: "current", label: t("outputs.regen.current") }, ...RUNTIMES.map((r) => ({ value: r.value, label: t(r.label) }))]} />
        </label>
        <label className="pc-regen__row">{t("outputs.regen.skill")}
          <PopupButton label={t("outputs.regen.skill")} value={skill} onAction={setSkill} options={[{ value: "", label: t("outputs.regen.current") }, ...types.map((x) => ({ value: x.id, label: x.label }))]} />
        </label>
        <fieldset className="pc-regen__row"><legend>{t("outputs.regen.sections")}</legend>
          {GROUPS.map((g) => <Checkbox key={g.id} label={t(g.label)} checked={picked.has(g.id)} onAction={(on) => setPicked((p) => { const n = new Set(p); on ? n.add(g.id) : n.delete(g.id); return n; })} />)}
        </fieldset>
        <p className="np-dim">{t("outputs.regen.note")}</p>
      </div>
      <SheetFooter defaultButton={<PushButton label={t("outputs.regen.confirm")} variant="primary" loading={busy} disabled={picked.size === 0} onAction={() => void submit()} />}>
        <PushButton label={t("outputs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-sheet
}

/** Opens the sheet for a call; registers it with the host the first time a page asks. */
export function useRegenerate(bridge: Bridge, callId: string) {
  const sheets = useSheetIfAny();
  useEffect(() => sheets?.register("regenerate", RegenerateSheet as never), [sheets]);
  return (sections: SectionKind[] = ["summary"]) => sheets?.open("regenerate", { bridge, callId, sections });
}
