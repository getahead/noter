// Announcement policy (DESIGN › Keyboard and VoiceOver, announcement table): one place decides
// whether, how loudly and through which route an event is spoken.
import type {
  AnnounceArgs,
  Ack,
  Politeness,
  Result,
  WindowLabel,
} from "../../core/bindings";
import type { Bridge } from "../bridge/bridge";

export type AnnounceKind =
  | "transcript_line"
  | "level_meter"
  | "clock_tick"
  | "countdown_second"
  | "capture_failure"
  | "call_ended"
  | "new_meeting"
  | "record_prompt"
  | "recording"
  | "card_new"
  | "cards_held"
  | "card_key"
  | "mode_change"
  | "presenting"
  | "outputs_ready"
  | "speaker_named"
  | "search_done"
  | "answer_ready"
  | "undo"
  | "proposal"
  | "confirmation"
  | "self_test"
  | "downloads_done";

export interface AnnounceEvent {
  kind: AnnounceKind;
  text: string;
  /** Names this occurrence for the once-per-event rule, e.g. `saved:<rev>`: a later event with the same text is spoken again. */
  key: string;
}

const SILENT: ReadonlySet<AnnounceKind> = new Set([
  "transcript_line",
  "level_meter",
  "clock_tick",
  "countdown_second",
]);
const ASSERTIVE: ReadonlySet<AnnounceKind> = new Set([
  "capture_failure",
  "call_ended",
  "new_meeting",
]);
const PANELS: ReadonlySet<WindowLabel> = new Set([
  "record-prompt",
  "call-screen",
]);

export type Route = { route: "native" | "live"; politeness: Politeness };

// @cpt-component:cpt-noter-component-ui-primitives:p1
// @cpt-algo:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1
export function routeAnnouncement(
  event: AnnounceEvent,
  win: { label: WindowLabel; isKey: boolean },
  announced: Set<string>,
): Route | null {
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-silent
  if (SILENT.has(event.kind)) {
    // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-silent
    return null;
    // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-silent
  }
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-silent
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-politeness
  const politeness: Politeness = ASSERTIVE.has(event.kind)
    ? "assertive"
    : "polite";
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-politeness
  const key = `${event.kind}\u0000${event.key}`;
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-repeat
  if (announced.has(key)) {
    // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-once
    return null;
    // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-once
  }
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-repeat
  announced.add(key);
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-panel
  if (PANELS.has(win.label) && !win.isKey) {
    // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-native
    return { route: "native", politeness };
    // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-native
  }
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-if-panel
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-live
  return { route: "live", politeness };
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-route-announcement:p1:inst-return-live
}

export interface AnnouncerEnv {
  label: WindowLabel;
  isKey: () => boolean;
  native: (args: AnnounceArgs) => Promise<Result<Ack>>;
  live: (politeness: Politeness, text: string) => void;
}

// @cpt-flow:cpt-noter-flow-ui-accessibility-l10n-announce:p1
// @cpt-dod:cpt-noter-dod-ui-accessibility-l10n-announce:p1
export function createAnnouncer(env: AnnouncerEnv) {
  // shortcut: the set is unbounded, fine for a window's lifetime; cap it if windows stay open for days.
  const announced = new Set<string>();
  return async function announce(event: AnnounceEvent): Promise<void> {
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-report-event
    const win = { label: env.label, isKey: env.isKey() };
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-report-event
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-route
    const r = routeAnnouncement(event, win, announced);
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-route
    if (!r) return;
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-if-native
    if (r.route === "native") {
      // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-api-announce
      const res = await env.native({
        text: event.text,
        politeness: r.politeness,
      });
      // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-api-announce
      // A failed native call falls back to the live region: better than silence.
      if (res.status === "ok") return;
    }
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-if-native
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-else-live
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-live-region
    env.live(r.politeness, event.text);
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-live-region
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-else-live
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-return-spoken
    return;
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-announce:p1:inst-return-spoken
  };
}

/** Writes into the window's live region: cleared now, filled a moment later, so a repeated identical text is still a change. */
export function writeLive(doc: Pick<Document, "querySelector">) {
  return (politeness: Politeness, text: string): void => {
    const el = doc.querySelector(`[data-live="${politeness}"]`);
    if (!el) return;
    el.textContent = "";
    setTimeout(() => (el.textContent = text), 50);
  };
}

const announcers = new WeakMap<Bridge, ReturnType<typeof createAnnouncer>>();

/** The announcer of a bridge, shared by every component of its window (one once-set). */
export function announcerFor(
  bridge: Bridge,
  env: Pick<AnnouncerEnv, "isKey" | "live">,
) {
  let a = announcers.get(bridge);
  if (!a) {
    a = createAnnouncer({
      label: bridge.label,
      native: bridge.core.windowAnnounce,
      ...env,
    });
    announcers.set(bridge, a);
  }
  return a;
}

export const useAnnounce = (bridge: Bridge) =>
  announcerFor(bridge, {
    isKey: () => document.hasFocus(),
    live: writeLive(document),
  });
