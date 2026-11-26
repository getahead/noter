// The identity commands of People: each returns the core's answer and offers its change to the Undo strip.
import type { Bridge } from "../../app/bridge/bridge";
import type { PersonPatch, PersonRow, VoiceRematch } from "../../core/bindings";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";
import { bumpPerson, setPersonStatus } from "./person-store";

const go = (bridge: Bridge, person_id: string) =>
  void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "person", person_id } }), { screen: "people" });

export type Outcome = "ok" | "conflict" | "failed";

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-update
/** `person_update` with the rev the sheet was opened on; a stale rev is re-read, never resubmitted. */
// @cpt-dod:cpt-noter-dod-ui-people-identity:p1
export async function updatePerson(bridge: Bridge, p: PersonRow, patch: PersonPatch): Promise<Outcome> {
  const res = await bridge.act("people:update", "person_update", () => bridge.core.personUpdate({ person_id: p.id, rev: p.rev, patch }), { screen: "people" });
  if (res.status === "error") {
    if (res.error.code === "conflict") bumpPerson();
    return res.error.code === "conflict" ? "conflict" : "failed";
  }
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("person.saved", { name: res.data.person.display_name }), refresh: bumpPerson });
  return "ok";
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-update

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge
/** `people_merge`: the kept person opens, the strip offers Undo with the core's change id. */
export async function mergePeople(bridge: Bridge, source: PersonRow, target: PersonRow): Promise<boolean> {
  const res = await bridge.act("people:merge", "people_merge", () => bridge.core.peopleMerge({ source: source.id, target: target.id }), { screen: "people" });
  if (res.status === "error") return false;
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("person.merged", { from: source.short_name, to: res.data.person.display_name }), refresh: bumpPerson });
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

// @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-profile-create
// @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-profile-on
// @cpt-begin:cpt-noter-flow-ui-people-voice-profile:p1:inst-create-profile
/** `voice_profile_create`: only ever from the sheet's explicit button, for one person. The result is what the core says; nothing is simulated. */
export async function createProfile(bridge: Bridge, person: PersonRow): Promise<boolean> {
  const res = await bridge.act("people:voice-create", "voice_profile_create", () => bridge.core.voiceProfileCreate({ person_id: person.id }), { screen: "people" });
  if (res.status === "error" || !res.data.enabled) return false;
  // @cpt-begin:cpt-noter-flow-ui-people-voice-profile:p1:inst-profile-result
  setPersonStatus({ id: person.id, text: t("person.voice.created", { name: person.short_name }) });
  bumpPerson();
  // @cpt-end:cpt-noter-flow-ui-people-voice-profile:p1:inst-profile-result
  // A new profile names its voice where past calls still have it unnamed (#1278); nothing found keeps "created".
  // Not awaited: the sheet closes now, so focus moves to Delete Profile… as without a re-match.
  void findInPastCalls(bridge, person, true);
  return true;
}

/** The status line of a re-match: what was named, or that nothing matched. */
export const rematchLine = (person: PersonRow, r: VoiceRematch): string =>
  r.speakers
    ? t("person.voice.found", { name: person.short_name, calls: t("person.voice.found_calls", { count: r.calls }), speakers: t("person.voice.found_speakers", { count: r.speakers }) })
    : t("person.voice.found_none", { name: person.short_name });

// @cpt-flow:cpt-noter-flow-ui-people-voice-rematch:p1
// @cpt-dod:cpt-noter-dod-ui-people-voice-rematch:p1
/** `voice_profile_rematch`: **Find in Past Calls**, and right after Create Profile; the names it gave go to Undo as one change. */
export async function findInPastCalls(bridge: Bridge, person: PersonRow, quiet = false): Promise<boolean> {
  // @cpt-begin:cpt-noter-flow-ui-people-voice-rematch:p1:inst-rematch-send
  const res = await bridge.act("people:voice-rematch", "voice_profile_rematch", () => bridge.core.voiceProfileRematch({ person_id: person.id }), { screen: "people" });
  // @cpt-end:cpt-noter-flow-ui-people-voice-rematch:p1:inst-rematch-send
  if (res.status === "error") return false;
  // @cpt-begin:cpt-noter-flow-ui-people-voice-rematch:p1:inst-rematch-result
  const text = rematchLine(person, res.data);
  if (res.data.change_id || !quiet) setPersonStatus({ id: person.id, text });
  // Only names given need the person read again; a needless re-read would take focus from Delete Profile….
  if (res.data.change_id) {
    holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: text, refresh: bumpPerson });
    bumpPerson();
  }
  // @cpt-end:cpt-noter-flow-ui-people-voice-rematch:p1:inst-rematch-result
  return true;
}
// @cpt-end:cpt-noter-flow-ui-people-voice-profile:p1:inst-create-profile
// @cpt-end:cpt-noter-state-ui-people-view:p1:inst-profile-on
// @cpt-end:cpt-noter-state-ui-people-view:p1:inst-profile-create

// @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-profile-off
// @cpt-begin:cpt-noter-flow-ui-people-voice-profile:p1:inst-return-profile
// @cpt-begin:cpt-noter-flow-ui-people-voice-profile:p1:inst-delete-profile
/** `voice_profile_delete`: the person is read again so Identity shows Off. */
export async function deleteProfile(bridge: Bridge, person: PersonRow): Promise<boolean> {
  const res = await bridge.act("people:voice-delete", "voice_profile_delete", () => bridge.core.voiceProfileDelete({ person_id: person.id }), { screen: "people" });
  if (res.status === "error") return false;
  setPersonStatus(null);
  bumpPerson();
  return true;
}
// @cpt-end:cpt-noter-flow-ui-people-voice-profile:p1:inst-delete-profile
// @cpt-end:cpt-noter-flow-ui-people-voice-profile:p1:inst-return-profile
// @cpt-end:cpt-noter-state-ui-people-view:p1:inst-profile-off
