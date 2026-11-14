import * as Core from "../fake-core";
import * as shared from "./shared";

export function appHandlers(fake: Core.FakeCore): Core.Handlers {
  return {
  // ── App ──────────────────────────────────────────────────────────────
  app_snapshot: (_a, { world, window }) => ({ ...world.app, copilot: world.app.copilot ? world.copilot : null, window }),
  stream_unsubscribe: (a, { fake }) => {
    fake.closeChannel(a.subscription_id, "unsubscribed");
    return shared.ack;
  },
  stream_ack: (a, { fake }) => {
    fake.acks.set(a.subscription_id, Math.max(fake.acks.get(a.subscription_id) ?? 0, a.seq));
    return shared.ack;
  },
  log_ui: () => shared.ack,
  banner_dismiss: (a, { world, publish }) => {
    world.app.banners.banners = world.app.banners.banners.filter((b) => b.type !== a.banner);
    publish("banners:changed");
    return world.app.banners;
  },

  };
}
