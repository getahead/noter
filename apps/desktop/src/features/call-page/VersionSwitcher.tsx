// The versions of a prose section: generated ones and the user's edits, read when the menu first opens, and Compare…
// Hidden while the section has one version. Choosing a version only shows it; nothing is written.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { OutputSection, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { loadVersions } from "./outputs-actions";
import { useVersions } from "./outputs-cache";
import { sectionId, versionLabel } from "./outputs-logic";

// @cpt-component:cpt-noter-component-ui-version-switcher:p1
export function VersionSwitcher({ bridge, section, prefs, showing, onShow, comparing, onCompare }: { bridge: Bridge; section: OutputSection; prefs: UiPrefs; showing: string | null; onShow: (id: string | null) => void; comparing: boolean; onCompare: () => void }) {
  const [open, setOpen] = useState(false);
  const id = sectionId("pc-ver", section.kind);
  const versions = useVersions(section.summary_id);
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-versions
  if (section.version_count < 2 || !section.summary_id) return null;
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-versions
  const toggle = () => {
    if (!open && !versions) void loadVersions(bridge, section.summary_id!);
    setOpen(!open);
  };
  const items = (versions?.versions ?? []).map((v) => ({ label: versionLabel(v, prefs), ...(v.id === showing ? { checked: true } : {}), onSelect: () => onShow(v.id) }));
  return <VersionMenu id={id} label={t("outputs.version")} open={open} onToggle={toggle} onClose={() => setOpen(false)} items={[...items, { divider: true }, { label: comparing ? t("outputs.hide_diff") : t("outputs.compare"), onSelect: onCompare }]} />;
}

/** The same menu surface serves output versions and the handoff caption; owners supply only available actions. */
export function VersionMenu({ id, label, ariaLabel, open, onToggle, onClose, items, caption }: { id: string; label: string; ariaLabel?: string; open: boolean; onToggle: () => void; onClose: () => void; items: MenuItem[]; caption?: boolean }) {
  return (
    <span className="pc-ver" data-variant={caption ? "caption" : undefined}>
      <PullDownButton id={id} label={label} ariaLabel={ariaLabel} buttonVariant="quiet" size="inline" open={open} onAction={onToggle} />
      {open && (
        <Popover variant="item-menu" anchor={globalThis.document?.getElementById(id) ?? null} align="end" label={t("outputs.version")} onClose={onClose}>
          <Menu items={items} onClose={onClose} />
        </Popover>
      )}
    </span>
  );
}
