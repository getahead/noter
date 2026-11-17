// The identity commands of People: each returns the core's answer and offers its change to the Undo strip.
import type { Bridge } from "../../app/bridge/bridge";
import type { PersonPatch, PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";
import { bumpPerson } from "./person-store";

const go = (bridge: Bridge, person_id: string) =>
  void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "person", person_id } }), { screen: "people" });

export type Outcome = "ok" | "conflict" | "failed";

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-update
/** `person_update` with the rev the sheet was opened on; a stale rev is re-read, never resubmitted. */
export async function updatePerson(bridge: Bridge, p: PersonRow, patch: PersonPatch): Promise<Outcome> {
  const res = await bridge.act("people:update", "person_update", () => bridge.core.personUpdate({ person_id: p.id, rev: p.rev, patch }), { screen: "people" });
  if (res.status === "error") {
    if (res.error.code === "conflict") bumpPerson();
    return res.error.code === "conflict" ? "conflict" : "failed";
  }
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("person.saved", { name: res.data.person.display_name }) });
  return "ok";
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-update

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge
/** `people_merge`: the kept person opens, the strip offers Undo with the core's change id. */
export async function mergePeople(bridge: Bridge, source: PersonRow, target: PersonRow): Promise<boolean> {
  const res = await bridge.act("people:merge", "people_merge", () => bridge.core.peopleMerge({ source: source.id, target: target.id }), { screen: "people" });
  if (res.status === "error") return false;
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("person.merged", { from: source.short_name, to: res.data.person.display_name }) });
  go(bridge, res.data.person.id);
  return true;
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-delete
/** `person_delete`: irreversible (no change id), so nothing goes to Undo. */
export async function deletePerson(bridge: Bridge, id: string): Promise<boolean> {
  const res = await bridge.act("people:delete", "person_delete", () => bridge.core.personDelete({ person_id: id }), { screen: "people" });
  return res.status === "ok";
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-delete
