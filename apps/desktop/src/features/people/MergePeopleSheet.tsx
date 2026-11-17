// Merge people (540 pt): Keep picker excluding the source and You, and What moves from the source's own page.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonPage, PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { mergePeople } from "./actions";

/** The people a merge can keep: everyone but You and the source. */
export const mergeTargets = (people: readonly PersonRow[], sourceId: string): PersonRow[] => people.filter((p) => !p.is_you && p.id !== sourceId);

/** The source's own page: what a merge moves. A failed read leaves the preview without calls and items. */
export async function readPreview(bridge: Bridge, id: string): Promise<PersonPage | null> {
  const r = await bridge.act("people:preview", "person_get", () => bridge.core.personGet({ person_id: id }), { screen: "people" });
  return r.status === "ok" ? r.data : null;
}

export function MergePeopleSheet({ close, bridge, source, people, target: first }: { close: () => void; bridge: Bridge; source: PersonRow; people: readonly PersonRow[]; target?: string }) {
  const targets = mergeTargets(people, source.id);
  const [targetId, setTargetId] = useState(first && targets.some((p) => p.id === first) ? first : "");
  const [page, setPage] = useState<PersonPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-preview
  useEffect(() => {
    let current = true;
    void readPreview(bridge, source.id).then((r) => current && setPage(r));
    return () => void (current = false);
  }, [bridge, source.id]);
  // @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-preview
  const target = targets.find((p) => p.id === targetId) ?? null;
  async function run() {
    if (!target) return;
    setBusy(true);
    const ok = await mergePeople(bridge, source, target);
    setBusy(false);
    setFailed(!ok);
    if (ok) close();
  }
  const title = t("person.merge.title", { name: source.short_name });
  return (
    <Sheet title={title} width={540} busy={busy} onCancel={close} onDefault={target ? () => void run() : undefined}>
      <div className="np-sheet__head"><div className="np-sheet__title">{title}</div><div className="np-sheet__sub">{t("person.merge.sub")}</div></div>
      <div className="np-sheet__body">
        <label className="pe-form__row">
          <span className="np-field__label">{t("person.merge.keep")}</span>
          <select className="np-field__input" aria-label={t("person.merge.keep")} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">{t("person.merge.choose")}</option>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </label>
        {target && (
          <>
            <div className="t-headline">{t("person.merge.moves", { name: target.display_name })}</div>
            <ul className="lb-movelist">
              {page && <li>{t("person.merge.calls", { count: page.calls.length })}</li>}
              {page && <li>{t("person.merge.items", { count: page.owns_open.length, name: source.short_name })}</li>}
              <li>{t("person.merge.names", { names: [...new Set([source.short_name, ...source.aliases])].join(", ") })}</li>
              {source.voice_profile && <li>{t("person.merge.voice")}</li>}
            </ul>
          </>
        )}
        {failed && <InlineBanner banner={{ id: "person-merge-error", severity: "error", text: t("person.merge.err") }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("person.merge.confirm")} variant="primary" submit disabled={!target} loading={busy} onAction={() => void run()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
