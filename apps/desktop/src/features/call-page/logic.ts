// Pure rules of the call page frame: the route key, the views delivered so far, the page's state, the
// subtitle and the Call info rows. Nothing here reads the store or draws.
import type { CommandState } from "../../app/store/window-store";
import type { CallPageTab, CallRow, UiPrefs } from "../../core/bindings";
import { duration, formatDateTime, t } from "../../i18n/format";
import type { MsgKey } from "../../i18n/en";

/** The page's route key in the Library section, as `navRoute` builds it for a `call_page` target. */
export const callKey = (callId: string, tab: CallPageTab): string => ["call", callId, tab].join(":");

export function parseCallKey(key: string): { callId: string; tab: CallPageTab } | null {
  const [kind, callId, tab] = key.split(":");
  return kind === "call" && callId && tab ? { callId, tab: tab as CallPageTab } : null;
}

/** DESIGN's order of the view control. */
const ORDER: readonly CallPageTab[] = ["summary", "transcript", "agent_reviews", "history"];

// @cpt-algo:cpt-noter-algo-ui-call-page-frame-views:p1
/** The segments the view control lists (only views a delivered feature registered) and the view to show. */
export function callViews(registered: readonly CallPageTab[], requested: CallPageTab): { segments: CallPageTab[]; view: CallPageTab } {
  // @cpt-begin:cpt-noter-algo-ui-call-page-frame-views:p1:inst-list-views
  const segments = ORDER.filter((v) => registered.includes(v));
  // @cpt-end:cpt-noter-algo-ui-call-page-frame-views:p1:inst-list-views
  // @cpt-begin:cpt-noter-algo-ui-call-page-frame-views:p1:inst-fallback
  const view = segments.includes(requested) ? requested : "transcript";
  // @cpt-end:cpt-noter-algo-ui-call-page-frame-views:p1:inst-fallback
  // @cpt-begin:cpt-noter-algo-ui-call-page-frame-views:p1:inst-return-views
  return { segments, view };
  // @cpt-end:cpt-noter-algo-ui-call-page-frame-views:p1:inst-return-views
}

export const VIEW_LABEL: Record<CallPageTab, MsgKey> = {
  summary: "callpage.view.summary",
  transcript: "callpage.view.transcript",
  agent_reviews: "callpage.view.agent_reviews",
  history: "callpage.view.history",
};

export type PageState = "LOADING" | "READY" | "NOT_FOUND" | "ERROR";

// @cpt-state:cpt-noter-state-ui-call-page-frame-page:p1
/** The page's state from the `call_get` command and whether the call is held; DELETED is the route leaving. */
export function pageState(read: CommandState | undefined, haveCall: boolean): PageState {
  // @cpt-begin:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-notfound
  // @cpt-begin:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-error
  // a failed read shows its error even when a list already put the row in the store
  if (read?.state === "ERROR") return read.error?.code === "not_found" ? "NOT_FOUND" : "ERROR";
  // @cpt-end:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-error
  // @cpt-end:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-notfound
  // @cpt-begin:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-ready
  if (haveCall) return "READY";
  // @cpt-end:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-ready
  // @cpt-begin:cpt-noter-state-ui-call-page-frame-page:p1:inst-error-loading
  return "LOADING";
  // @cpt-end:cpt-noter-state-ui-call-page-frame-page:p1:inst-error-loading
}

const dayOf = (ms: number, prefs: UiPrefs): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: prefs.time_zone || undefined }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(ms);
  }
};
const clock = (ms: number, prefs: UiPrefs): string => {
  const o: Intl.DateTimeFormatOptions = { timeStyle: "short", hourCycle: prefs.time_format === "h12" ? "h12" : "h23" };
  try {
    return new Intl.DateTimeFormat("en", { ...o, timeZone: prefs.time_zone || undefined }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en", o).format(ms);
  }
};
/** "Nov 15": a day without a year, in the user's zone. */
export const shortDay = (ms: number, prefs: UiPrefs): string => {
  const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en", { ...o, timeZone: prefs.time_zone || undefined }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en", o).format(ms);
  }
};

/** **Today 10:00**, or the date and time of another day. */
export const whenLabel = (ms: number, now: number, prefs: UiPrefs): string =>
  dayOf(ms, prefs) === dayOf(now, prefs) ? t("callpage.when_today", { time: clock(ms, prefs) }) : formatDateTime(ms, prefs);

const people = (c: CallRow): string => c.participants.map((p) => p.short_name).join(", ");

/** PC-R1's subtitle: **Today 10:00 · 48 min · Anna K., Pavel, Dmitri S., You**. */
export const subtitleOf = (c: CallRow, now: number, prefs: UiPrefs): string =>
  t("callpage.subtitle", { when: whenLabel(c.started_at, now, prefs), length: duration(c.duration_ms / 1000), people: people(c) });

export interface InfoModel {
  participants: CallRow["participants"];
  call: Array<{ label: string; value: string }>;
  sensitive: boolean;
  audio: string;
  audioKept: boolean;
  processing: string;
}

const STATUS: Record<CallRow["status"], MsgKey> = {
  recording: "callpage.info.status.recording",
  paused: "callpage.info.status.paused",
  processing: "callpage.info.status.processing",
  ready: "callpage.info.status.ready",
  failed: "callpage.info.status.failed",
};

/** PC-R4 Call info: the rows of its five sections. `typeLabel` is the call type's name from `call_types_list`. */
export function callInfo(c: CallRow, extra: { audio_not_stored: boolean }, now: number, prefs: UiPrefs, typeLabel: string): InfoModel {
  const kept = !c.audio_deleted && !extra.audio_not_stored;
  // shortcut: the core sends no deletion date, so a deleted call's audio shows the date it was due, or the call's own day; replace when the contract has one
  const audio = c.audio_deleted
    ? t("callpage.info.audio_deleted", { date: shortDay(c.audio_kept_until ?? c.started_at, prefs) })
    : extra.audio_not_stored || c.audio_kept_until == null
      ? t("callpage.info.audio_not_stored")
      : t("callpage.info.kept_until", { date: shortDay(c.audio_kept_until, prefs) });
  return {
    participants: c.participants,
    call: [
      { label: t("callpage.info.type"), value: typeLabel },
      { label: t("callpage.info.app"), value: c.platform ?? t("callpage.info.no_app") },
      { label: t("callpage.info.when"), value: whenLabel(c.started_at, now, prefs) },
      { label: t("callpage.info.length"), value: duration(c.duration_ms / 1000) },
      { label: t("callpage.info.languages"), value: c.languages.map((l) => (typeof l === "string" ? l : l.code).toUpperCase()).join(", ") },
    ],
    sensitive: c.privacy === "sensitive",
    audio,
    audioKept: kept,
    processing: t(STATUS[c.status]),
  };
}

/** Calls `set(true)` once `active` has held for `ms` (and `set(false)` while it does not); returns the cleanup. */
export function afterTimer(ms: number, active: boolean, set: (late: boolean) => void): (() => void) | undefined {
  if (!active) return void set(false);
  const id = setTimeout(() => set(true), ms);
  return () => clearTimeout(id);
}
