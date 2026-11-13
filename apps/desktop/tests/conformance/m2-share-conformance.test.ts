// 2.18 call page actions on the fake and the real core: share_copy copies only the ready sections and never a
// rejected item, in each of its three formats; audio_delete and audio_delete_older remove the audio and keep the
// transcript and the outputs. An item section copies the call's items as they are now, not the text written with it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Core, ShareScope } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario, type World } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";

const SUMMARY = "Backend and QA aligned on the websocket notifications";
const TOKEN = "Rotate the staging Jira token";
const everything: ShareScope = { sections: [], item_ids: [], include_unreviewed: true };

async function storedAudioFolder(callId: string): Promise<string | null> {
  if (s.target !== "stdio") return null;
  const wire = (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<{ path: string }> } }).process;
  const { path } = await wire.invoke("main", "harness.data_dir", {});
  return join(path, "audio", callId);
}

let s: Scenario;
let main: Core;
const open = (world?: (w: World) => void) => {
  s = openScenario({ alsoRecord: exercised, world });
  main = s.core("main");
};
beforeEach(() => open());
afterEach(async () => {
  await s.dispose();
});

const copy = (scope: Partial<ShareScope> = {}, format: "slack" | "jira" | "markdown" = "markdown") =>
  main.shareCopy({ call_id: PAST_CALL, scope: { ...everything, ...scope }, format });

describe("share_copy", () => {
  it("copies the ready Summary while Action Items is still writing, and refuses a scope with nothing ready", async () => {
    await s.dispose();
    open((w) => {
      const out = w.outputs.find((o) => o.call_id === PAST_CALL)!;
      out.status = "writing";
      out.sections.find((x) => x.kind === "action_items")!.state = { type: "writing" };
    });
    const done = ok(await copy());
    expect(done.sections).toBe(1);
    expect(done.text).toContain(SUMMARY);
    expect(done.text).not.toContain(TOKEN);
    expect(refused(await copy({ sections: ["action_items"] })).code).toBe("outputs_not_ready");
  });

  it("never copies a rejected item", async () => {
    expect(ok(await copy()).text).toContain(TOKEN);
    await s.dispose();
    open((w) => [...w.items, ...w.outputs.flatMap((o) => o.sections.flatMap((x) => x.items))].forEach((i) => i.id === "itm_token" && (i.review = "rejected")));
    expect(ok(await copy()).text).not.toContain(TOKEN);
    // the section's only item is rejected, so it has nothing to copy
    expect(refused(await copy({ sections: ["action_items"] })).code).toBe("outputs_not_ready");
  });

  it("writes each of the three formats in its own markup", async () => {
    const texts = [];
    for (const format of ["slack", "jira", "markdown"] as const) {
      const done = ok(await copy({}, format));
      expect(done.text).toContain(TOKEN);
      texts.push(done.text);
    }
    expect(new Set(texts).size).toBe(3);
  });

  it("refuses an item that is not in the chosen sections", async () => {
    expect(refused(await copy({ item_ids: ["itm_nobody"] })).code).toBe("invalid_input");
  });
});

describe("audio_delete and audio_delete_older", () => {
  /** The call's audio, transcript and Summary as the Call page reads them. */
  async function stored(call_id: string) {
    const snap = ok(await main.transcriptSubscribe({ call_id }, () => {}));
    const out = ok(await main.outputsGet({ call_id }));
    return { audio: snap.audio_available, segments: snap.segments.length, summary: out.sections.find((x) => x.kind === "summary")?.body_md ?? null };
  }

  it("audio_delete removes a stored call's audio once and keeps its transcript and Summary", async () => {
    const folder = await storedAudioFolder(PAST_CALL);
    const before = await stored(PAST_CALL);
    expect(before.segments).toBeGreaterThan(0);
    if (folder) expect(existsSync(join(folder, "mic.m4a"))).toBe(true);
    expect(ok(await main.audioDelete({ call_ids: [PAST_CALL] })).calls).toBe(1);
    expect(ok(await main.callGet({ call_id: PAST_CALL })).call.audio_deleted).toBe(true);
    expect(await stored(PAST_CALL)).toEqual({ ...before, audio: false });
    if (folder) expect(existsSync(join(folder, "mic.m4a"))).toBe(false);
    expect(ok(await main.audioDelete({ call_ids: [PAST_CALL] })).calls).toBe(0);
  });

  it("audio_delete_older removes the audio of calls older than the cutoff, never the live call's, and refuses no days", async () => {
    expect(refused(await main.audioDeleteOlder({ older_than_days: 0 })).code).toBe("invalid_input");
    const folder = await storedAudioFolder(PAST_CALL);
    const before = await stored(PAST_CALL);
    expect(ok(await main.audioDeleteOlder({ older_than_days: 1 })).calls).toBe(1);
    expect(ok(await main.callGet({ call_id: PAST_CALL })).call.audio_deleted).toBe(true);
    expect(ok(await main.callGet({ call_id: LIVE_CALL })).call.audio_deleted).toBe(false);
    expect(await stored(PAST_CALL)).toEqual({ ...before, audio: false });
    if (folder) expect(existsSync(join(folder, "mic.m4a"))).toBe(false);
    expect(ok(await main.audioDeleteOlder({ older_than_days: 1 })).calls).toBe(0);
  });
});
