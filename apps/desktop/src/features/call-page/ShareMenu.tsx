// Share (cpt-noter-component-ui-share-menu): the toolbar's pull-down and each section's share button. The first line
// names the scope, then the notices, the three copies and Export…; a copy confirms on the control that invoked it.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { SectionKind } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { SECTION_LABEL } from "./outputs-logic";
import { openReview } from "../items/review-banner";
import { useOutputs } from "./outputs-cache";
import { scopeLine, shareState, type ShareOrigin } from "./share-logic";
import { exportOpener, runShare, setShareStatus, unreviewedIn, useShareStatus } from "./share-run";

/** The menu's items for a scope: the shown scope, what the core will warn about, the copies and Export. */
export function shareItems(o: { origin: ShareOrigin; ready: boolean; sensitive: boolean; status: ReturnType<typeof useShareStatus>; unreviewed: number; copy: (f: "slack" | "jira" | "markdown", unreviewed?: boolean) => void; exportIt: () => void; startReview?: () => void }): MenuItem[] {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-menu
  const un = o.unreviewed > 0 && o.status?.kind === "unreviewed" ? o.status : null;
  const copies: Array<["slack" | "jira" | "markdown", "share.slack" | "share.jira" | "share.markdown", string]> = [
    ["slack", "share.slack", "⇧⌘C"],
    ["jira", "share.jira", "⌥⌘C"],
    ["markdown", "share.markdown", "⌥⇧⌘C"],
  ];
  return [
    { header: scopeLine(o.origin) },
    ...(o.ready ? [] : [{ label: t("share.nothing"), disabled: true }]),
    ...(o.unreviewed > 0 ? [{ label: t("share.unreviewed", { count: o.unreviewed }), disabled: true }, ...(un ? [{ label: t("share.copy_anyway"), onSelect: () => o.copy(un.format, true) }] : []), { label: t("share.start_review"), onSelect: o.startReview ?? (() => {}) }] : []),
    ...(o.sensitive ? [{ label: t("share.sensitive"), disabled: true }] : []),
    { divider: true },
    ...copies.map(([f, key, kbd]) => ({ label: t(key), kbd, disabled: !o.ready, onSelect: () => o.copy(f) })),
    { divider: true },
    { label: t("share.export"), kbd: "⌘E", disabled: !o.ready, onSelect: o.exportIt },
  ];
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-menu
}

const sameOrigin = (a: ShareOrigin, b: ShareOrigin) => a.type === b.type && (a.type === "toolbar" || (a.kind === (b as typeof a).kind && (a.type !== "row" || a.id === (b as typeof a).id)));

/** One Share control: a labelled pull-down on the toolbar, an icon button on a section. */
// @cpt-component:cpt-noter-component-ui-share-menu:p1
// @cpt-dod:cpt-noter-dod-ui-call-page-outputs-actions:p1
export function ShareMenu({ bridge, callId, origin, id }: { bridge: Bridge; callId: string; origin: ShareOrigin; id: string }) {
  const outputs = useOutputs(callId);
  const status = useShareStatus();
  const itemRecords = useWindow(bridge, (s) => s.entities.item);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mine = status && status.callId === callId && sameOrigin(status.origin, origin) ? status : null;
  const unreviewed = unreviewedIn(callId, origin, itemRecords);
  const privacy = useWindow(bridge, (s) => s.entities.call[callId]?.privacy);
  const { ready, sensitive } = shareState(outputs, privacy);
  const toggle = () => setAnchor(anchor ? null : globalThis.document?.getElementById(id) ?? null);
  const label = origin.type === "toolbar" ? t("callpage.share") : origin.type === "row" ? t("share.item") : t("share.section", { section: t(SECTION_LABEL[origin.kind]) });
  return (
    <span data-component="cpt-noter-component-ui-share-menu" style={{ display: "contents" }}>
      {origin.type !== "toolbar" ? <IconButton id={id} icon="export" label={label} size="inline" onAction={toggle} /> : <PullDownButton id={id} icon="export" label={mine?.kind === "copied" ? mine.text : label} ariaLabel={label} variant="toolbar" open={anchor !== null} onAction={toggle} />}
      {mine?.kind === "copied" && <InlineStatus text={mine.text} variant="on-label" onExpire={() => setShareStatus(null)} />}
      {(mine?.kind === "nothing" || mine?.kind === "failed" || (mine?.kind === "unreviewed" && unreviewed > 0)) && <span role="status" className="np-dim">{mine.kind === "unreviewed" ? t("share.unreviewed", { count: unreviewed }) : t(mine.kind === "nothing" ? "share.nothing" : "share.failed")}</span>}
      {anchor && (
        <Popover variant="item-menu" anchor={anchor} align="end" label={label} onClose={() => setAnchor(null)}>
          <Menu items={shareItems({ origin, ready, sensitive, unreviewed, status: mine, copy: (f, u) => void runShare(bridge, callId, origin, f, u ?? unreviewed > 0), exportIt: () => exportOpener.open?.(origin), startReview: () => void openReview(bridge, callId) })} onClose={() => setAnchor(null)} />
        </Popover>
      )}
    </span>
  );
}
