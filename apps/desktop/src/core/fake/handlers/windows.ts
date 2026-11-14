import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function windowsHandlers(fake: Core.FakeCore): Core.Handlers {
  return {
  // ── Windows ──────────────────────────────────────────────────────────
  window_show_call: (_a, { fake, publish }) => {
    // A second request makes it key (PM-40).
    Object.assign(fake.callWindow, { key: fake.callWindow.visible, visible: true });
    if (fake.callWindow.layout === "floating" && !fake.handlerState.shareWarningSeen) {
      fake.callWindow.show_share_warning = true;
      fake.handlerState.shareWarningSeen = true;
    }
    publish("window:call");
    return fake.callWindow;
  },
  window_hide_call: (_a, { fake, publish }) => {
    Object.assign(fake.callWindow, { visible: false, key: false });
    publish("window:call");
    return fake.callWindow;
  },
  window_call_state: (_a, { fake }) => fake.callWindow,
  window_share_warning_seen: (_a, { fake, publish }) => {
    fake.handlerState.shareWarningSeen = true;
    fake.callWindow.show_share_warning = false;
    publish("window:call");
    return fake.callWindow;
  },
  window_set_call_layout: (a, { world, fake, publish }) => {
    const twoDisplays = world.app.environment.displays.length > 1;
    fake.callWindow.layout = a.preference === "floating" || !twoDisplays ? "floating" : "dedicated";
    world.settings.call_screen.layout = a.preference;
    if (fake.callWindow.layout === "floating" && !fake.handlerState.shareWarningSeen) {
      fake.callWindow.show_share_warning = true;
      fake.handlerState.shareWarningSeen = true;
    }
    publish("window:call");
    return fake.callWindow;
  },
  window_set_collapsed: (a, { fake, publish }) => {
    fake.callWindow.collapsed = a.collapsed;
    publish("window:call");
    return fake.callWindow;
  },
  app_set_hidden_for_presenting: (a, { world, publish }) => {
    world.app.presenting.hidden = a.hidden;
    world.copilot.card_keys.registered = !a.hidden && world.copilot.muted === null && shared.live(world.app.capture);
    publish("app:presenting");
    publish("copilot:status");
    return world.app.presenting;
  },
  window_navigate: (a, { world, emit }) => {
    let target = a.target;
    // Open Last Summary: the Summary of the latest call whose outputs are ready, as the core resolves it; none, none.
    if (target?.type === "last_summary") {
      const latest = world.calls.filter((c) => world.outputs.some((o) => o.call_id === c.id && o.status === "ready")).sort((x, y) => y.started_at - x.started_at)[0];
      target = latest ? { type: "call_page", call_id: latest.id, tab: "summary", span: null } : null;
    }
    if (target) emit("nav:request", target);
    return shared.ack;
  },
  window_report_view: () => shared.ack,
  // The Edit menu's Fix Term… is native: the fake has no menu to enable.
  window_set_fix_term_enabled: () => ({}),
  window_announce: (a) => {
    if (!a.text.trim()) throw coreError("invalid_input", "text", { type: "validation", field: "text", rule: "required" });
    return shared.ack;
  },
  window_fit: (a) => {
    for (const field of ["width", "height"] as const)
      if (a[field] === 0) throw coreError("invalid_input", field, { type: "validation", field, rule: "required" });
    return shared.ack;
  },
  open_external: (a) => {
    if (a.target.type === "url" && !/^https?:\/\//.test(a.target.url)) throw coreError("invalid_input", "http(s) only", { type: "validation", field: "url", rule: "invalid_format" });
    return shared.ack;
  },
  };
}
