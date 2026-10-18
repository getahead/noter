import { base, cx } from "./attrs";

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** key-cap: a shortcut hint such as ⌃⌥⌘R. Hidden from VoiceOver: the shortcut belongs to the owning control. */
export function KeyCap({ keys, cls }: { keys: string; cls?: string }) {
  return (
    <kbd {...base("key-cap", { variant: keys.length > 1 ? "chord" : "single" })} className={cx("np-kbd", cls)} aria-hidden="true">
      {keys}
    </kbd>
  );
}
