// toolbar of the prototype's main window (src/js/05-shell.js): the unified toolbar the owner fills with its
// groups (back and forward, title, centre item, trailing items, search). Tab goes through its items.
import type { ReactNode } from "react";
import { base } from "./attrs";

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Toolbar({ region, label, children }: { region?: string; label?: string; children?: ReactNode }) {
  return (
    <header className="np-toolbar" {...base("toolbar", { region })} role="toolbar" aria-label={label}>
      {children}
    </header>
  );
}

/** Flexible space between toolbar groups (the prototype's toolbarSpacer). */
export const ToolbarSpacer = () => <span className="np-tb__spacer" />;
