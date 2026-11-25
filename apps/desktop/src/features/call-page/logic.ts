// Pure rules of the call page frame: the route key, the views delivered so far, the page's state, the
// subtitle and the Call info rows. Nothing here reads the store or draws.
import type { CommandState } from "../../app/store/window-store";
import type { CallPageTab, CallRow, TimeSpan, UiPrefs } from "../../core/bindings";
import { clock, dayOf, duration, shortDay, t, zoned } from "../../i18n/format";
import type { MsgKey } from "../../i18n/en";

/** `call:<id>:<tab>`, plus `:<t0>:<t1>` when evidence opened it on a span (the Transcript highlights it). */
export function parseCallKey(key: string): { callId: string; tab: CallPageTab; span?: TimeSpan } | null {
  const [kind, callId, tab, t0, t1] = key.split(":");
  if (kind !== "call" || !callId || !tab) return null;
  return { callId, tab: tab as CallPageTab, ...(t0 && t1 ? { span: { call_id: callId, channel: null, t0_ms: Number(t0), t1_ms: Number(t1) } } : {}) };
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

/** **Today 10:00** or **Thu 2 Oct 16:00** (subtitle); **Today · 10:00** or **Thu 2 Oct · 16:00** (Call info's When, `info`). Short
 * weekday and month forms, the year only for another year, no "at" (Content rules › Dates and times). */
export const whenLabel = (ms: number, now: number, prefs: UiPrefs, info = false): string => {
  const time = clock(ms, prefs);
  if (dayOf(ms, prefs) === dayOf(now, prefs)) return t(info ? "callpage.info.when_today" : "callpage.when_today", { time });
  const year = (x: number) => zoned(x, { year: "numeric" }, prefs);
  const date = zoned(ms, { weekday: "short", month: "short", day: "numeric", ...(year(ms) === year(now) ? {} : { year: "numeric" }) }, prefs);
  return t(info ? "callpage.info.when_day" : "callpage.when_day", { date, time });
};

const people = (c: CallRow): string => c.participants.map((p) => c.invited_ids?.includes(p.id) ? t("callpage.invited", { name: p.short_name }) : p.short_name).join(", ");

/** PC-R1's subtitle: **Today 10:00 · 48 min · Anna K., Pavel, Dmitri S., You**. */
export const subtitleOf = (c: CallRow, now: number, prefs: UiPrefs): string =>
  c.participants.length
    ? t("callpage.subtitle", { when: whenLabel(c.started_at, now, prefs), length: duration(c.duration_ms / 1000), people: people(c) })
    : t("callpage.subtitle_alone", { when: whenLabel(c.started_at, now, prefs), length: duration(c.duration_ms / 1000) });

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

/** There is audio to delete: not deleted, stored, and with a retention date (issue 1050; Call info and the ⋯ menu). */
export const audioKept = (c: Pick<CallRow, "audio_deleted" | "audio_kept_until">, audioNotStored: boolean): boolean =>
  !c.audio_deleted && !audioNotStored && c.audio_kept_until != null;

/** PC-R4 Call info: the rows of its five sections. `typeLabel` is the call type's name from `call_types_list`. */
export function callInfo(c: CallRow, extra: { audio_not_stored: boolean }, now: number, prefs: UiPrefs, typeLabel: string): InfoModel {
  const kept = audioKept(c, extra.audio_not_stored);
  // shortcut: a call deleted before the core recorded the day falls back to the date it was due, or the call's own day
  const audio = c.audio_deleted
    ? t("callpage.info.audio_deleted", { date: shortDay(c.audio_deleted_at ?? c.audio_kept_until ?? c.started_at, prefs) })
    : extra.audio_not_stored || c.audio_kept_until == null
      ? t("callpage.info.audio_not_stored")
      : t("callpage.info.kept_until", { date: shortDay(c.audio_kept_until, prefs) });
  return {
    participants: c.participants,
    call: [
      { label: t("callpage.info.type"), value: typeLabel },
      { label: t("callpage.info.app"), value: c.platform ?? t("callpage.info.no_app") },
      { label: t("callpage.info.when"), value: whenLabel(c.started_at, now, prefs, true) },
      { label: t("callpage.info.length"), value: duration(c.duration_ms / 1000) },
      { label: t("callpage.info.languages"), value: c.languages.map((l) => (typeof l === "string" ? l : l.code).toUpperCase()).join(", ") },
    ],
    sensitive: c.privacy === "sensitive",
    audio,
    audioKept: kept,
    processing: t(STATUS[c.status]),
  };
}
