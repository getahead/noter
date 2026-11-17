// Edit details (520 pt): the person's own fields; a changed name offers to keep the old one as an alias.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonPatch, PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { TextField } from "../../ui/primitives/text-field";
import { updatePerson } from "./actions";
import { readPerson } from "./PersonPage";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-alias
/** The patch for the draft: only what changed. `aliases` is the whole wanted list; `notes` is prefilled from the row, so a cleared field clears them. */
export function patchOf(p: PersonRow, d: { name: string; aka: string; email: string; role: string; org: string; notes: string; keep: boolean }): PersonPatch {
  const name = d.name.trim();
  const renamed = name !== "" && name !== p.display_name;
  const aliases = [...new Set([...list(d.aka), ...(renamed && d.keep ? [p.display_name] : [])])].filter((a) => a !== (renamed ? name : p.display_name));
  const patch: PersonPatch = {};
  if (renamed) patch.display_name = name;
  if (aliases.join("\n") !== p.aliases.join("\n")) patch.aliases = aliases;
  if (d.email.trim() !== (p.email ?? "")) patch.email = d.email.trim() || null;
  if (d.role.trim() !== (p.role ?? "")) patch.role = d.role.trim() || null;
  if (d.org.trim() !== (p.org ?? "")) patch.org = d.org.trim() || null;
  if (d.notes !== (p.notes ?? "")) patch.notes = d.notes || null;
  return patch;
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-alias

type Draft = { name: string; aka: string; email: string; role: string; org: string; notes: string; keep: boolean };
type Field = keyof Draft;

/** The draft over a fresher record: fields the user edited stay theirs, every other field shows the current value. */
export function rebaseDraft(d: Draft, fresh: PersonRow, touched: ReadonlySet<Field>, name: string): Draft {
  const current: Draft = { name: fresh.display_name, aka: fresh.aliases.join(", "), email: fresh.email ?? "", role: fresh.role ?? "", org: fresh.org ?? "", notes: fresh.notes ?? "", keep: d.keep };
  const out = { ...current } as Record<Field, string | boolean>;
  (Object.keys(d) as Field[]).forEach((k) => touched.has(k) && (out[k] = k === "name" ? name : d[k]));
  return out as Draft;
}

export function EditPersonSheet({ close, bridge, person: opened }: { close: () => void; bridge: Bridge; person: PersonRow }) {
  // the record the sheet saves against: a refused stale save replaces it with the current one, the draft stays
  const [person, setPerson] = useState(opened);
  const [d, setD] = useState({ name: person.display_name, aka: person.aliases.join(", "), email: person.email ?? "", role: person.role ?? "", org: person.org ?? "", notes: person.notes ?? "", keep: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"conflict" | "failed" | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const set = (k: keyof typeof d) => (v: string) => (setTouched(new Set(touched).add(k)), setD({ ...d, [k]: v }));
  const renamed = d.name.trim() !== "" && d.name.trim() !== person.display_name;
  async function save() {
    setBusy(true);
    // @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-error
    // @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-if-error
    const outcome = await updatePerson(bridge, person, patchOf(person, d));
    setBusy(false);
    if (outcome === "ok") return close();
    setError(outcome); // the draft stays
    if (outcome === "conflict") {
      const fresh = await readPerson(bridge, person.id);
      if (fresh.page) (setPerson(fresh.page.person), setD(rebaseDraft(d, fresh.page.person, touched, d.name)));
    }
    // @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-if-error
    // @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-error
  }
  const field = (k: keyof typeof d, label: string, multi = false) => <TextField label={label} showLabel value={d[k] as string} multiline={multi} onChange={set(k)} onEnter={multi ? undefined : () => void save()} />;
  return (
    <Sheet title={t("person.edit.title")} width={520} busy={busy} onCancel={close} onDefault={() => void save()}>
      <div className="np-sheet__head"><div className="np-sheet__title">{t("person.edit.title")}</div></div>
      <div className="np-sheet__body pe-form">
        {field("name", t("person.edit.name"))}
        {renamed && <Checkbox label={t("person.edit.keep_alias", { name: person.display_name })} checked={d.keep} onAction={(v) => setD({ ...d, keep: v })} />}
        {field("aka", t("person.edit.aka"))}
        {field("email", t("person.edit.email"))}
        <div className="pe-form__2">{field("role", t("person.edit.role"))}{field("org", t("person.edit.org"))}</div>
        {field("notes", t("person.edit.notes"), true)}
        {error && <InlineBanner banner={{ id: "person-edit-error", severity: "error", text: t(error === "conflict" ? "person.edit.conflict" : "person.edit.err") }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("person.edit.save")} variant="primary" submit loading={busy} onAction={() => void save()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
