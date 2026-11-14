import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function firstRunHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── First run and permissions ────────────────────────────────────────
  setup_status: (_a, { world }) => world.app.setup,
  models_download: (a, { world, fake, publish }) => {
    const m = world.app.setup.models;
    if (a.action !== "pause" && !world.app.environment.online) throw coreError("offline");
    const corrupt = a.action !== "pause" && fake.corruptDownload; // one shot: the speech bundle fails its check
    if (corrupt) fake.corruptDownload = false;
    if (a.action !== "pause") m.error = null;
    m.bundles.forEach((b) => {
      if (b.state === "ready") return;
      b.state = a.action === "pause" ? "paused" : "downloading";
    });
    publish("setup:changed");
    if (a.action !== "pause") {
      fake.later(800, () => {
        m.bundles.forEach((b) => {
          if (b.state !== "downloading") return;
          if (corrupt && b.required_for_capture) {
            b.state = "checksum_failed";
            m.error = "checksum_failed";
          } else Object.assign(b, { state: "ready", done_mb: b.size_mb });
        });
        m.done_mb = m.bundles.reduce((n, b) => n + b.done_mb, 0);
        publish("setup:changed");
      });
    }
    return world.app.setup;
  },
  permission_request: (a, { world, publish }) => {
    const row = world.app.setup.permissions.find((p) => p.kind === a.kind);
    if (!row) throw coreError("not_found");
    if (row.state === "denied") throw coreError("permission_denied", "turn it on in System Settings", { type: "permission", kind: a.kind });
    row.state = "granted";
    const env = world.app.environment.permissions.find((p) => p.kind === a.kind);
    if (env) env.state = "granted";
    if (a.kind === "notifications") world.app.environment.notifications = "authorized";
    publish("setup:changed");
    publish("env:changed");
    return row;
  },
  // @cpt-flow:cpt-noter-flow-core-first-run-self-test:p1
  self_test_run: (_a, { world, fake, send, publish }) => {
    // D-21: the same refusal as the core (core-first-run inst-if-model-missing), before the Channel opens.
    if (world.app.setup.models.bundles.some((b) => b.required_for_capture && b.state !== "ready")) throw coreError("model_missing", "the live model is not downloaded");
    const sub = newId("sub");
    fake.openChannel(sub, "self_test_run", send as (m: unknown) => void);
    if (fake.holdSelfTest) {
      fake.holdSelfTest = false;
      return { subscription_id: sub, last_seq: 0 };
    }
    const at = (ms: number, event: Parameters<typeof fake.push<"self_test_run">>[1]["event"]) => fake.later(ms, () => fake.push(sub, { event }));
    at(300, { type: "stream_arrived", channel: "mic" });
    at(600, { type: "stream_arrived", channel: "sys" });
    at(900, { type: "levels", mic_db: -32, sys_db: -28 });
    at(1200, { type: "line", channel: "sys", text: "This is the Noter self-test." });
    at(1500, { type: "passed" });
    fake.later(1500, () => {
      world.app.setup.self_test = { type: "passed", at: shared.now() };
      world.app.setup.detection_enabled = world.settings.general.offer_to_record;
      publish("setup:changed");
    });
    at(1600, { type: "ended", reason: "call_stopped" });
    return { subscription_id: sub, last_seq: 0 };
  },
  setup_set_call_display: (a, { world, publish }) => {
    if (a.display_id && !world.app.environment.displays.some((d) => d.id === a.display_id)) throw coreError("not_found", `display ${a.display_id}`);
    world.app.setup.call_display = a.display_id ?? null;
    world.settings.call_screen.display_id = a.display_id ?? null;
    world.settings.rev += 1;
    publish("settings:changed");
    publish("setup:changed");
    return world.app.setup;
  },
  setup_set_audio_storage: (a, { world, publish }) => {
    world.settings.audio.retention = a.never_store_audio ? "never_store" : a.retention;
    world.settings.rev += 1;
    publish("settings:changed");
    publish("setup:changed");
    return world.app.setup;
  },
  setup_set_step: (a, { world, publish }) => {
    const row = world.app.setup.steps.find((s) => s.step === a.step);
    if (!row) throw coreError("not_found");
    row.state = a.state;
    world.app.setup.complete = world.app.setup.steps.every((s) => s.state !== "todo");
    publish("setup:changed");
    return world.app.setup;
  },

  };
}
