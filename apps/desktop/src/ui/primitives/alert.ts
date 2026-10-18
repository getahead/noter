// alert: native (DESIGN 3.2 › Primitives inventory). macOS draws it; dialogs-host asks for it. This fixes only
// what DESIGN asks of the WebView side: variants and the macOS 26 button order, buttons side by side with the
// default button trailing (as the prototype's src/js/05-shell.js lays them out).

export type AlertVariant = "informational" | "warning" | "destructive";
export interface AlertButton {
  label: string;
  /** "primary" is the default button. */
  variant?: string;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function alertButtons<B extends AlertButton>(buttons: B[]): (B | AlertButton)[] {
  if (!buttons.length) return [{ label: "OK", variant: "primary" }];
  return [...buttons.filter((b) => b.variant !== "primary"), ...buttons.filter((b) => b.variant === "primary")];
}
