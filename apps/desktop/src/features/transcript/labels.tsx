// Speaker label and language tag (DESIGN › Speaker label, Language tag; prototype src/js/04-shared.js C.speakerLabel,
// C.languageTag). Display only: the rename popover arrives with cpt-noter-feature-ui-speakers (M2).
import type { Lang } from "../../core/bindings";
import { cx } from "../../ui/primitives/attrs";
import { langTag, type SpeakerVariant } from "./model";

// @cpt-component:cpt-noter-component-ui-speaker-label:p1
// @cpt-dod:cpt-noter-dod-ui-live-transcript-labels:p1
export function SpeakerLabel({ text, variant }: { text: string; variant: SpeakerVariant }) {
  const secondary = variant !== "you" && variant !== "resolved";
  return (
    <span data-component="cpt-noter-component-ui-speaker-label" data-variant={variant} className={cx("np-spk", secondary && "is-secondary")} title={text}>
      {text}
    </span>
  );
}

// @cpt-component:cpt-noter-component-ui-language-tag:p1
/** **RU**, or **RU?** with a dashed outline under low confidence; VoiceOver reads the language's name. */
export function LanguageTag({ lang, confidence = null, variant = "segment" }: { lang: Lang; confidence?: number | null; variant?: "segment" | "call" | "filter" }) {
  const tag = langTag(lang, confidence);
  return (
    <span data-component="cpt-noter-component-ui-language-tag" data-variant={variant} data-state={tag.low ? "low-confidence" : "default"} className={cx("np-lang", tag.low && "is-low")} title={tag.label} aria-label={tag.label} role="img">
      {tag.text}
    </span>
  );
}
