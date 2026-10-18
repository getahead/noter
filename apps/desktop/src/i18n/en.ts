// The v1 English catalogue (translations are v1.x). `{name}` is a placeholder; `{ one, other }` is a
// plural message chosen by the `count` argument.
export const en = {
  "window.error": "Something went wrong",
  "action.try_again": "Try Again",
  "announce.recording_started": "Recording started",
  "announce.recording_stopped": "Recording stopped, saved {duration}",
  "announce.cards_held": { one: "{count} new card waiting", other: "{count} new cards waiting" },
  "announce.search_done": { one: "{count} result", other: "{count} results" },
  "announce.copied": "Copied for {target}",
  "action.dismiss": "Dismiss",
  "action.ok": "OK",
  "banner.more": "+{count} More",
  "progress.percent": "{value} percent",
  "search.remove_token": "Remove {label}",
  "source_list.needs_attention": "Needs attention",
  "source_list.problem": "problem",
} as const;

export type MsgKey = keyof typeof en;
