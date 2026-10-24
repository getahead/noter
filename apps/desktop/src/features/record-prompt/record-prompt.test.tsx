// The panel for each variant against the real bridge and the fake core: what it draws, and what its buttons send.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CaptureNotice } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { notNowItems, RecordPrompt } from "./RecordPrompt";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => bridge.close());

const TEAMS = { app_name: "Microsoft Teams", bundle_id: "com.microsoft.teams2" };
async function ready(more: (w: FakeCore["world"]) => void = () => {}, detect: { app_name: string; bundle_id: string } | null = TEAMS) {
  fake = new FakeCore({ window: "record-prompt" });
  const w = fake.world;
  w.app.capture.phase = "idle";
  w.app.capture.notice = null;
  w.app.setup.complete = true;
  w.app.presenting.hidden = false;
  w.app.detection.detection = detect && { id: `det_${detect.bundle_id}`, ...detect, matched_event: null, detected_at: 0, prompt_until: 30_000, blocked: null };
  more(w);
  bridge = createBridge("record-prompt", fake);
  await bridge.open();
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r));
const html = () => renderToString(<RecordPrompt bridge={bridge} />);
/** The handlers of this render's buttons, taken before any of them runs (a command changes what the panel draws). */
const buttons = (...labels: string[]) => {
  const tree = rendered(RecordPrompt, { bridge });
  return labels.map((label) => find(tree, (p) => p.label === label && typeof p.onAction === "function").props.onAction as () => void);
};
const press = (...labels: string[]) => buttons(...labels).forEach((run) => run());
const live = (n: CaptureNotice) => (w: FakeCore["world"]) => {
  w.app.capture.phase = "recording";
  w.app.capture.call_id = "call_live";
  w.app.capture.notice = n;
};

describe("Default", () => {
  it("draws the title, the source line, Record with its key and Record as Sensitive", async () => {
    await ready();
    const out = html();
    expect(out).toContain('data-variant="default"');
    expect(out).toContain('data-state="default"');
    for (const s of ["Record this call?", "Microsoft Teams is using the microphone", "Record as Sensitive", "⌃⌥⌘R", 'data-region="RP-R1"', 'data-region="RP-R3"']) expect(out).toContain(s);
  });

  it("Record and Record as Sensitive start the capture with the detection", async () => {
    await ready();
    const seen = sent();
    press("Record", "Record as Sensitive");
    await settle();
    const starts = seen.filter(([c]) => c === "capture_start").map(([, a]) => a);
    expect(starts).toEqual([
      { source: "record_prompt", sensitive: false, detection_id: "det_com.microsoft.teams2" },
      { source: "record_prompt", sensitive: true, detection_id: "det_com.microsoft.teams2" },
    ]);
  });

  it("× closes it with reason closed", async () => {
    await ready();
    const seen = sent();
    press("Close");
    await settle();
    expect(seen).toContainEqual(["capture_dismiss_detection", { detection_id: "det_com.microsoft.teams2", reason: "closed" }]);
  });

  it("a browser's Don't Ask line is the browser's; the Not Now items close for now or ask for the app", async () => {
    const calls: string[] = [];
    const items = notNowItems("Safari", () => calls.push("not-now"), () => calls.push("dont-ask"));
    items.forEach((i) => "label" in i && i.onSelect?.());
    expect(calls).toEqual(["not-now", "dont-ask"]);
    expect(items.map((i) => ("label" in i ? i.label : "-"))).toEqual(["Not Now", "-", "Don't Ask for Safari…"]);
    await ready(() => {}, { app_name: "Safari", bundle_id: "com.apple.Safari" });
    expect(html()).toContain("Safari is using the microphone");
  });
});

describe("the refusal variants", () => {
  it("Disk full: the reason with the free space, Record disabled, no Record as Sensitive, Delete Old Audio… asks the main window", async () => {
    await ready((w) => {
      w.app.detection.detection!.blocked = "disk_full";
      w.app.environment.disk_free_mb = 420;
    });
    const out = html();
    expect(out).toContain('data-variant="disk-full"');
    expect(out).toContain('data-state="disabled"');
    expect(out).toContain("Not enough disk space to record (420 MB free)");
    expect(out).not.toContain("Record as Sensitive");
    const seen = sent();
    press("Delete Old Audio…");
    await settle();
    expect(seen.filter(([c]) => c === "window_navigate")).toHaveLength(1);
  });

  it("Speech model: the reason with the percentage, no Record as Sensitive", async () => {
    await ready((w) => {
      w.app.detection.detection!.blocked = "model_missing";
      Object.assign(w.app.setup.models.bundles.find((b) => b.required_for_capture)!, { state: "downloading", size_mb: 1000, done_mb: 620 });
    });
    const out = html();
    expect(out).toContain('data-variant="model-missing"');
    expect(out).toContain("The speech model is still downloading (62 %)");
    expect(out).not.toContain("Record as Sensitive");
  });

  it("System audio off: a warning above an enabled Record, Open System Settings… opens its pane", async () => {
    await ready((w) => {
      for (const rows of [w.app.setup.permissions, w.app.environment.permissions]) rows.find((p) => p.kind === "system_audio")!.state = "denied";
    });
    const out = html();
    expect(out).toContain('data-variant="system-audio-off"');
    expect(out).toContain("System audio access is off · only your side will be recorded");
    const seen = sent();
    press("Open System Settings…");
    await settle();
    expect(seen).toContainEqual(["open_external", { target: { type: "system_settings", permission: "system_audio" } }]);
  });
});

describe("no panel", () => {
  it("is drawn for no detection, an incomplete setup, or while hidden for presenting", async () => {
    await ready(() => {}, null);
    expect(html()).toBe("");
    await bridge.close();
    await ready((w) => (w.app.setup.complete = false));
    expect(html()).toBe("");
    await bridge.close();
    await ready((w) => (w.app.presenting.hidden = true));
    expect(html()).toBe("");
  });
});

describe("the notice variants", () => {
  it("call-ended: the countdown with the app, Stop Now and Keep Recording answer the core", async () => {
    await ready(live({ type: "call_ended", stops_at: Date.now() + 10_000 }), null);
    const out = html();
    expect(out).toContain('data-variant="call-ended"');
    expect(out).toContain('data-state="countdown-running"');
    expect(out).toMatch(/Stopping in \d+ s\./);
    const seen = sent();
    press("Stop Now", "Keep Recording");
    await settle();
    expect(seen.filter(([c]) => c === "capture_answer_call_end").map(([, a]) => a)).toEqual([
      { call_id: "call_live", choice: "stop_now" },
      { call_id: "call_live", choice: "keep_recording" },
    ]);
  });

  it("call-ended while the core holds the countdown reads Paused while you're here", async () => {
    await ready(live({ type: "call_ended", stops_at: null }), null);
    const out = html();
    expect(out).toContain('data-state="countdown-paused"');
    expect(out).toContain("Paused while you&#x27;re here");
  });

  it("new-meeting: the event's title, and both answers", async () => {
    await ready(live({ type: "new_meeting", event: { id: "e", title: "1:1 with Anna K.", starts_at: 0, ends_at: 1 }, app_name: "Microsoft Teams", detected_at: 0, expires_at: 60_000, default_choice: "start_as_new_call" }), null);
    const out = html();
    expect(out).toContain('data-variant="new-meeting"');
    expect(out).toContain("A new meeting may have started: 1:1 with Anna K.");
    const seen = sent();
    press("Keep in This Call", "Start as New Call");
    await settle();
    expect(seen.filter(([c]) => c === "capture_answer_new_meeting").map(([, a]) => a)).toEqual([
      { call_id: "call_live", choice: "keep_in_this_call" },
      { call_id: "call_live", choice: "start_as_new_call" },
    ]);
  });
});
