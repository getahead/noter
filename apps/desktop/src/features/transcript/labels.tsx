// Speaker label and language tag (DESIGN › Speaker label, Language tag; prototype src/js/04-shared.js C.speakerLabel,
// C.languageTag). A named or provisional speaker is a button that opens the rename popover (cpt-noter-feature-ui-speakers).
import type { Lang } from "../../core/bindings";
import { cx } from "../../ui/primitives/attrs";
import { langTag, type SpeakerVariant } from "./model";

// @cpt-component:cpt-noter-component-ui-speaker-label:p1
// @cpt-dod:cpt-noter-dod-ui-live-transcript-labels:p1
export function SpeakerLabel({ text, variant, onRename }: { text: string; variant: SpeakerVariant; onRename?: (anchor: HTMLElement) => void }) {
  const secondary = variant !== "you" && variant !== "resolved";
  const props = { "data-component": "cpt-noter-component-ui-speaker-label", "data-variant": variant, className: cx("np-spk", secondary && "is-secondary", onRename && "np-spk--btn"), title: text };
  return onRename ? (
    <button type="button" {...props} onClick={(e) => onRename(e.currentTarget)}>
      {text}
    </button>
  ) : (
    <span {...props}>{text}</span>
  );
}

// @cpt-component:cpt-noter-component-ui-language-tag:p1
/** **RU**, or **RU?** with a dashed outline when language ID was unsure; VoiceOver reads the language's name. */
export function LanguageTag({ lang, langP = null, variant = "segment" }: { lang: Lang; langP?: number | null; variant?: "segment" | "call" | "filter" }) {
  const tag = langTag(lang, langP);
  return (
    <span data-component="cpt-noter-component-ui-language-tag" data-variant={variant} data-state={tag.low ? "low-confidence" : "default"} className={cx("np-lang", tag.low && "is-low")} title={tag.label} aria-label={tag.label} role="img">
      {tag.text}
    </span>
  );
}
