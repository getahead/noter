// 2.17 post-call outputs against the fake and the real core: the five output commands on the
// fixture's written backend call — the sections, an edit with its revision and change, the
// version chain, a regeneration through `outputs:progress` that keeps the edit, and the typed
// errors. The pipeline itself (stop → PostCall → sections in order, the notification, the archive
// pass) exists only in the real core: m2-stories-postcall.test.ts.
import { afterEach, describe, expect, it } from "vitest";

import type { EntityChanged, OutputSection } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

const CALL = "call_backend";
const SUMMARY = "sum_backend";

let s: Scenario;
afterEach(async () => {
  await s.dispose();
});

const summaryOf = (sections: OutputSection[]) => sections.find((x) => x.kind === "summary")!;
const sectionOf = (e: EntityChanged) => (e.type === "section" && e.section.summary_id === SUMMARY ? e.section : undefined);

describe("post-call output commands (2.17)", () => {
  it("outputs_get answers the written sections; output_edit saves the user's text with a new rev, a change and entity:changed", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const out = ok(await main.outputsGet({ call_id: CALL }));
    expect(out).toMatchObject({ call_id: CALL, status: "ready" });
    const summary = summaryOf(out.sections);
    expect(summary).toMatchObject({ summary_id: SUMMARY, state: { type: "ready" }, user_edited: false });
    expect(summary.body_md).toContain("websocket notifications");
    const changed = await s.events("entity:changed");
    const body = `${summary.body_md} The reconnect owner is Dmitri.`;
    const edit = ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: summary.rev!, body_md: body }));
    expect(edit.section).toMatchObject({ summary_id: SUMMARY, body_md: body, user_edited: true });
    expect(edit.section.rev).toBeGreaterThan(summary.rev!);
    expect(edit.change_id).toBeTruthy();
    await until(() => changed.all.map(sectionOf).find((x) => x?.body_md === body), "the edited section through entity:changed");
    expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections).body_md).toBe(body);
    // The old rev is stale now.
    expect(refused(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: summary.rev!, body_md: "x" })).code).toBe("conflict");
  });

  it("output_versions lists the chain oldest first, ending with the user's edit; output_version_get reads each version", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const before = ok(await main.outputVersions({ summary_id: SUMMARY })).versions;
    const summary = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
    const body = "Backend owns the reconnect.";
    ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: summary.rev!, body_md: body }));
    const versions = ok(await main.outputVersions({ summary_id: SUMMARY })).versions;
    expect(versions).toHaveLength(before.length + 1);
    expect(versions.map((v) => v.n)).toEqual(versions.map((_, i) => i + 1));
    expect(versions.at(-1)).toMatchObject({ kind: "user_edit", writer: null });
    expect(versions[0]).toMatchObject({ kind: "generated" });
    expect(ok(await main.outputVersionGet({ summary_id: SUMMARY, version_id: versions.at(-1)!.id })).body_md).toBe(body);
    const first = ok(await main.outputVersionGet({ summary_id: SUMMARY, version_id: versions[0].id }));
    expect(first.meta).toMatchObject({ n: 1, kind: "generated" });
    expect(first.body_md).toContain("websocket notifications");
  });

  it("output_versions of a section the world says was edited ends with the user's edit", async () => {
    s = openScenario({
      alsoRecord: exercised,
      world: (w) => {
        summaryOf(w.outputs.find((o) => o.call_id === CALL)!.sections).user_edited = true;
      },
    });
    const versions = ok(await s.core("main").outputVersions({ summary_id: SUMMARY })).versions;
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.at(-1)).toMatchObject({ kind: "user_edit" });
    expect(versions[0]).toMatchObject({ kind: "generated" });
  });

  it("outputs_regenerate answers a job run, the sections pass through outputs:progress, and the user's edit is kept", async () => {
    s = openScenario({ alsoRecord: exercised, world: W.idle });
    const main = s.core("main");
    const summary = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
    const body = `${summary.body_md} Dmitri owns the reconnect.`;
    ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: summary.rev!, body_md: body }));
    const progress = await s.events("outputs:progress");
    const run = ok(await main.outputsRegenerate({ call_id: CALL, sections: ["summary"], local: false }));
    expect(run.job_run_id).toBeTruthy();
    await until(() => progress.all.find((p) => p.call_id === CALL && p.section === "summary" && p.state.type === "ready"), "the summary ready through outputs:progress");
    const after = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
    expect(after.user_edited).toBe(true);
    expect(after.body_md).toContain("Dmitri owns the reconnect.");
  });

  it("the typed errors: unknown call, summary and version are not_found; the call screen may not edit", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    expect(refused(await main.outputsGet({ call_id: "call_nope" })).code).toBe("not_found");
    expect(refused(await main.outputVersions({ summary_id: "sum_nope" })).code).toBe("not_found");
    expect(refused(await main.outputVersionGet({ summary_id: SUMMARY, version_id: "ver_nope" })).code).toBe("not_found");
    expect(refused(await main.outputEdit({ call_id: CALL, summary_id: "sum_nope", rev: 1, body_md: "x" })).code).toBe("not_found");
    expect(refused(await main.outputsRegenerate({ call_id: "call_nope", sections: ["summary"], local: false })).code).toBe("not_found");
    expect(refused(await s.core("call-screen").outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: 2, body_md: "x" })).code).toBe("window_not_allowed");
  });
});

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-regenerate:p1
it("Use Local Model (regenerate with local) makes the local model the section's writer, on both cores", async () => {
  s = openScenario({ alsoRecord: exercised, world: W.idle });
  const main = s.core("main");
  const before = ok(await main.outputsGet({ call_id: CALL }));
  expect(summaryOf(before.sections).writer?.runtime).not.toBe("local");
  expect(before.written_locally).toBe(false);
  const progress = await s.events("outputs:progress");
  ok(await main.outputsRegenerate({ call_id: CALL, sections: ["summary"], local: true }));
  await until(() => progress.all.find((x) => x.section === "summary" && x.state.type === "ready"), "locally rewritten summary");
  const after = ok(await main.outputsGet({ call_id: CALL }));
  expect(summaryOf(after.sections).writer).toMatchObject({ runtime: "local" });
  expect(after.written_locally).toBe(true);
  expect(after.sections.filter((x) => x.kind !== "summary").every((x) => x.writer?.runtime !== "local")).toBe(true);
});

it("a rejected suggestion leaves its section and counts as suppressed in that section only, on both cores", async () => {
  s = openScenario({
    alsoRecord: exercised,
    world: (w) => {
      W.idle(w);
      for (const i of [...w.items, ...w.outputs.flatMap((o) => o.sections.flatMap((x) => x.items))]) if (i.id === "itm_token") i.review = "suggested";
    },
  });
  const main = s.core("main");
  const before = ok(await main.outputsGet({ call_id: CALL })).sections;
  expect(before.every((x) => x.suppressed_count === 0)).toBe(true);
  const row = before.flatMap((x) => x.items).find((i) => i.id === "itm_token")!;
  const home = before.find((x) => x.items.some((i) => i.id === row.id))!;
  ok(await main.itemReview({ item_id: row.id, rev: row.rev, decision: "reject" }));
  const after = ok(await main.outputsGet({ call_id: CALL })).sections;
  const section = after.find((x) => x.kind === home.kind)!;
  expect(section.suppressed_count).toBe(1);
  expect(section.items.map((i) => i.id)).not.toContain(row.id);
  expect(after.filter((x) => x.kind !== home.kind).every((x) => x.suppressed_count === 0)).toBe(true);
});

// @cpt-flow:cpt-noter-flow-ui-menu-bar-start:p1
it("Open Last Summary (window_navigate last_summary) opens the Summary of the latest call with ready outputs, on both cores", async () => {
  s = openScenario({ alsoRecord: exercised, world: W.idle });
  const nav = await s.events("nav:request");
  ok(await s.core("main").windowNavigate({ target: { type: "last_summary" } }));
  await until(() => nav.latest(), "nav:request");
  expect(nav.latest()).toMatchObject({ type: "call_page", call_id: CALL, tab: "summary" });
});

// @cpt-flow:cpt-noter-flow-ui-speakers-post-call:p1
it.each(["rename", "name"] as const)("speaker %s publishes names_updated and regeneration clears it on both cores", async (method) => {
  s = openScenario({ alsoRecord: exercised, world: W.idle });
  const main = s.core("main");
  const detail = ok(await main.callGet({ call_id: CALL }));
  const speaker = detail.speakers.find((x) => x.label.type === "person")!;
  const name = speaker.label.type === "person" ? speaker.label.person.display_name : "";
  const before = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
  expect(before.names_updated).toBe(false);
  ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: before.rev!, body_md: `${name} owns this. My note stays.` }));
  const changed = await s.events("entity:changed");
  const person = { type: "new" as const, display_name: "Renamed Person" };
  const mutation = method === "rename" ? ok(await main.transcriptRenameSpeaker({ call_id: CALL, speaker_id: speaker.id, person, scope: { type: "whole_call" } }))
    : ok(await main.transcriptNameSpeakers({ call_id: CALL, assignments: [{ speaker_id: speaker.id, person }] }));
  const named = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
  expect(named).toMatchObject({ names_updated: true, user_edited: true, body_md: "Renamed Person owns this. My note stays." });
  await until(() => changed.all.map(sectionOf).find((x) => x?.names_updated), "named section event");
  ok(await main.changeUndo({ target: { type: "change", change_id: mutation.change_id } }));
  expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections)).toMatchObject({ names_updated: false, body_md: `${name} owns this. My note stays.` });
  ok(await main.changeRedo({ target: { type: "change", change_id: mutation.change_id } }));
  expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections).names_updated).toBe(true);
  const progress = await s.events("outputs:progress");
  ok(await main.outputsRegenerate({ call_id: CALL, sections: ["summary"], local: false }));
  await until(() => progress.all.find((x) => x.section === "summary" && x.state.type === "ready"), "regenerated summary");
  expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections).names_updated).toBe(false);
});

it("redoing a speaker name never overwrites an output edited after Undo", async () => {
  s = openScenario({ alsoRecord: exercised, world: W.idle });
  const main = s.core("main");
  const speaker = ok(await main.callGet({ call_id: CALL })).speakers.find((x) => x.label.type === "person")!;
  const name = speaker.label.type === "person" ? speaker.label.person.display_name : "";
  const before = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
  ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: before.rev!, body_md: `${name} owns this.` }));
  const named = ok(await main.transcriptNameSpeakers({ call_id: CALL, assignments: [{ speaker_id: speaker.id, person: { type: "new", display_name: "Renamed Person" } }] }));
  const target = { type: "change" as const, change_id: named.change_id };
  ok(await main.changeUndo({ target }));
  const undone = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
  ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: undone.rev!, body_md: "My later edit must survive." }));
  const redo = await main.changeRedo({ target });
  expect(redo).toEqual({ status: "ok", data: { undone: 0, skipped_edited_later: 1 } });
  expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections).body_md).toBe("My later edit must survive.");
});

it("a second rename replaces an escaped speaker name without introducing raw HTML", async () => {
  s = openScenario({ alsoRecord: exercised, world: W.idle });
  const main = s.core("main");
  const speaker = ok(await main.callGet({ call_id: CALL })).speakers.find((x) => x.label.type === "person")!;
  const name = speaker.label.type === "person" ? speaker.label.person.display_name : "";
  const before = summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections);
  ok(await main.outputEdit({ call_id: CALL, summary_id: SUMMARY, rev: before.rev!, body_md: `${name} owns this.` }));
  for (const [display_name, expected] of [["Anna <QA>", "Anna &lt;QA> owns this."], ["Lena", "Lena owns this."]]) {
    ok(await main.transcriptRenameSpeaker({ call_id: CALL, speaker_id: speaker.id, person: { type: "new", display_name }, scope: { type: "whole_call" } }));
    expect(summaryOf(ok(await main.outputsGet({ call_id: CALL })).sections).body_md).toBe(expected);
  }
});
