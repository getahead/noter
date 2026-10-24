import type { CallRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import type { IconName } from "../../ui/icons";

export interface CellStatus {
  state:
    | "summary-failed"
    | "writing-summary"
    | "speakers-not-named"
    | "archive-pending";
  text: string;
  icon?: IconName;
  spin?: boolean;
  tone?: "error";
  /** The text links to the call's page (the naming panel arrives in M2). */
  link?: boolean;
}

// @cpt-algo:cpt-noter-algo-ui-library-calls-status-cell:p1
/** The first that applies: summary failed, writing, speakers not named, archive pending; null when none. */
export function statusOf(c: CallRow): CellStatus | null {
  // @cpt-begin:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-order
  if (c.outputs === "failed")
    return {
      state: "summary-failed",
      icon: "error",
      text: t("library.status.failed"),
      tone: "error",
    };
  if (c.outputs === "writing")
    return {
      state: "writing-summary",
      spin: true,
      text: t("library.status.writing"),
    };
  if (c.unnamed_speakers > 0)
    return {
      state: "speakers-not-named",
      icon: "person",
      text: t("library.status.speakers", { count: c.unnamed_speakers }),
      link: true,
    };
  if (c.archive === "pending" || c.archive === "failed")
    return {
      state: "archive-pending",
      icon: "clock",
      text: t("library.status.archive"),
    };
  return null;
  // @cpt-end:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-order
}

// "15 Nov": en-US supplies the short month ("Sep", where en-GB says "Sept"); the day goes first, as in the prototype
const day = (ms: number, tz?: string) => {
  const p = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: tz,
  }).formatToParts(ms);
  return `${p.find((x) => x.type === "day")!.value} ${p.find((x) => x.type === "month")!.value}`;
};

/** The help tag of the audio-deleted glyph (D-36: no date, no retention). */
export function audioDeletedHelp(c: CallRow): string | null {
  // @cpt-begin:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-audio-glyph
  return c.audio_deleted ? t("library.row.audio_deleted") : null;
  // @cpt-end:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-audio-glyph
}

export { day as shortDay };
