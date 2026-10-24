// @cpt-algo:cpt-noter-algo-ui-accessibility-l10n-format:p1
// @cpt-dod:cpt-noter-dod-ui-accessibility-l10n-strings:p1
// String formatting: one catalogue message per string, placeholders filled, never concatenated.
import type { UiPrefs } from "../core/bindings";
import { en, type MsgKey } from "./en";

export type Quoted = { quoted: string; lang: string };
export type Arg = string | number | Quoted;
export type Part = { text: string; lang?: string };

const INTERFACE_LANG = "en";
/** The macOS locale for dates, numbers and money. */
const locale = () =>
  (typeof navigator === "undefined" ? "" : navigator.language) || "en";

export type Pseudo = "off" | "cyrillic" | "german";
let pseudo: Pseudo = "off";
export const setPseudo = (mode: Pseudo): void => void (pseudo = mode);

const CYRILLIC: Record<string, string> = {
  a: "а",
  e: "е",
  o: "о",
  p: "р",
  c: "с",
  x: "х",
  y: "у",
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
};
const GERMAN: Record<string, string> = {
  a: "ä",
  o: "ö",
  u: "ü",
  s: "ß",
  A: "Ä",
  O: "Ö",
  U: "Ü",
};
const PLACEHOLDER = /\{(\w+)\}/g;

/** Pseudo-localises the literal text of a message (placeholders stay), padded: Cyrillic +40 %, German +30 % (+40 % up to 10 chars). */
function pseudoize(msg: string): string {
  if (pseudo === "off") return msg;
  const map = pseudo === "cyrillic" ? CYRILLIC : GERMAN;
  const literal = msg.replace(PLACEHOLDER, "");
  const grow = pseudo === "cyrillic" || literal.length <= 10 ? 0.4 : 0.3;
  const pad = (pseudo === "cyrillic" ? "ж" : "ö").repeat(
    Math.ceil(literal.length * grow),
  );
  let out = "";
  let last = 0;
  for (const m of msg.matchAll(PLACEHOLDER)) {
    out +=
      [...msg.slice(last, m.index)].map((c) => map[c] ?? c).join("") + m[0];
    last = m.index + m[0].length;
  }
  return out + [...msg.slice(last)].map((c) => map[c] ?? c).join("") + pad;
}

/** The message as parts: plain text, and quoted user text carrying its own `lang`. */
export function tParts(key: MsgKey, args: Record<string, Arg> = {}): Part[] {
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-pick-message
  const m: string | { one: string; other: string } = en[key];
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-pick-message
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-plural
  const template =
    typeof m === "string"
      ? m
      : m[
          new Intl.PluralRules(INTERFACE_LANG).select(Number(args.count)) ===
          "one"
            ? "one"
            : "other"
        ];
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-plural
  const parts: Part[] = [];
  const push = (text: string, lang?: string) => {
    const prev = parts.at(-1);
    if (prev && !prev.lang && !lang) prev.text += text;
    else if (text) parts.push(lang ? { text, lang } : { text });
  };
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-format-values
  const numbers = new Intl.NumberFormat(locale());
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-format-values
  let last = 0;
  const msg = pseudoize(template);
  for (const p of msg.matchAll(PLACEHOLDER)) {
    push(msg.slice(last, p.index));
    last = p.index + p[0].length;
    const v = args[p[1]!];
    if (typeof v === "object") push(v.quoted, v.lang);
    else push(typeof v === "number" ? numbers.format(v) : (v ?? p[0]));
  }
  push(msg.slice(last));
  // @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-return-string
  return parts;
  // @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-return-string
}

export const t = (key: MsgKey, args?: Record<string, Arg>): string =>
  tParts(key, args)
    .map((p) => p.text)
    .join("");

// @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-quote-user-text
/** Quoted user text: “text” in its own language. */
export const quote = (text: string, lang: string): Quoted => ({
  quoted: `“${text}”`,
  lang,
});
// @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-quote-user-text

// @cpt-begin:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-format-values
export const formatDateTime = (ms: number, prefs: UiPrefs): string => {
  const o: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: prefs.time_format === "h12" ? "h12" : "h23",
  };
  try {
    return new Intl.DateTimeFormat(locale(), {
      ...o,
      timeZone: prefs.time_zone || undefined,
    }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(locale(), o).format(ms); // a zone this WebView does not know: the system zone
  }
};

/** Call-relative time, always HH:MM:SS. */
export const callTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds) || 0);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

/** A short localised duration, e.g. "48 min"; seconds only under a minute. */
export const duration = (seconds: number): string => {
  const s = Math.round(seconds);
  const unit = (n: number, unit: string) =>
    new Intl.NumberFormat(locale(), {
      style: "unit",
      unit,
      unitDisplay: "short",
    }).format(n);
  if (s < 60) return unit(s, "second");
  const units = [
    [Math.floor(s / 3600), "hour"],
    [Math.floor(s / 60) % 60, "minute"],
  ] as const;
  // Intl.DurationFormat would do this, but Node 22 (CI) lacks it.
  return new Intl.ListFormat(locale(), { style: "short", type: "unit" }).format(
    units.filter(([n]) => n > 0).map(([n, u]) => unit(n, u)),
  );
};

export const usd = (amount: number): string =>
  new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "USD",
  }).format(amount);
// @cpt-end:cpt-noter-algo-ui-accessibility-l10n-format:p1:inst-format-values
