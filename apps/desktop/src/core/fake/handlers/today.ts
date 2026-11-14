import * as Core from "../fake-core";
import * as shared from "./shared";

export function todayHandlers(fake: Core.FakeCore): Core.Handlers {
  return {
  // ── Today ────────────────────────────────────────────────────────────
  today_get: (_a, { world }) => shared.todayView(world),

  };
}
