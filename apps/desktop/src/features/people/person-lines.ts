// The Person page's text lines that read the page as a whole: the PE-R1 subtitle and the PE-R5
// Languages and Voice profile values (DESIGN People; issue 1152).
import type { LanguageShare, PersonPage, UiPrefs, VoiceProfileStats } from "../../core/bindings";
import { shortDay, t, zoned } from "../../i18n/format";
import { langName } from "../transcript/model";

/** "1:1 weekly", "every 2 weeks", "1:1"; null when the core saw no pattern. */
function cadenceText(c: PersonPage["cadence"]): string | null {
  if (!c) return null;
  const every = c.every ? t(`person.cadence.${c.every}`) : null;
  if (c.one_on_one) return every ? t("person.cadence.one_on_one_every", { every }) : t("person.cadence.one_on_one");
  return every;
}

/** **Frontend · 31 calls since Sep · 1:1 weekly** (PE-R1). */
export function personSubtitle(page: Pick<PersonPage, "person" | "calls" | "cadence">, prefs: UiPrefs | undefined): string | undefined {
  const first = page.calls.length ? Math.min(...page.calls.map((c) => c.started_at)) : null;
  const calls = first === null ? null : t("person.calls_since", { count: page.calls.length, month: zoned(first, { month: "short" }, prefs) });
  const line = [page.person.role, calls, cadenceText(page.cadence)].filter(Boolean).join(" · ");
  return line || undefined;
}

/** **Russian 71 % · English 26 % · German 3 %** (PE-R5 Languages); null without transcribed lines. */
export function languagesLine(languages: readonly LanguageShare[]): string | null {
  if (!languages.length) return null;
  return languages.map((l) => t("person.language_share", { lang: langName(l.lang), share: Math.round((l.share ?? 0) * 100) })).join(" · ");
}

/** **On since 3 Oct · 2 profiles · matched in 28 calls** (PE-R5 Voice profile). `profiles` counts the
 *  profiles kept, not the ones that matched, so the two counts stay apart. */
export function voiceLine(stats: VoiceProfileStats, prefs: UiPrefs | undefined): string {
  const on = stats.opted_in_at != null ? t("person.voice_since", { date: shortDay(stats.opted_in_at, prefs) }) : t("person.voice_on");
  // a count of 0 (right after Create Profile) reads as broken, so it is left out
  const counts = [stats.profiles > 0 && t("person.voice_profiles_n", { count: stats.profiles }), stats.matched_calls > 0 && t("person.voice_matched_in", { count: stats.matched_calls })];
  return [on, ...counts].filter(Boolean).join(" · ");
}
