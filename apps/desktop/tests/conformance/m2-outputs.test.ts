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
