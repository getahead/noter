// Inline banner and its slot, from the prototype's src/js/04-shared.js (C.inlineBanner) and the MW-R5 slot of
// src/js/05-shell.js: one banner per slot, the most severe first, **+N More** listing the rest in place.
// The banners come from the owning screen, which maps them from typed errors and degraded events and runs the
// commands behind their actions.
import { useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../primitives/attrs";
import { IconButton } from "../primitives/icon-button";
import { Link } from "../primitives/link";
import { Progress } from "../primitives/progress";
import { PushButton } from "../primitives/push-button";
import { orderBanners, pruneDismissed, visibleBanners, type Severity } from "./banners";

export interface BannerAction {
  label: string;
  onAction?: () => void;
  variant?: "secondary" | "primary" | "quiet" | "destructive";
  /** The owner's command for this action is running. */
  loading?: boolean;
  link?: boolean;
}

export interface Banner {
  id: string;
  severity: Severity;
  title?: string;
  /** One sentence: the cause and the fix. */
  text: string;
  actions?: BannerAction[];
  /** 0 to 100. */
  progress?: number;
  compact?: boolean;
  /** Info and success by default; the warning **Noter quit during …** sets it too. */
  dismissible?: boolean;
}

const SEV_ICON: Record<Severity, IconName> = { info: "info", warning: "warning", error: "error", degraded: "warning", success: "checkCircle" };

export interface InlineBannerProps {
  banner: Banner;
  /** The number of banners waiting behind this one. */
  more?: number;
  /** The waiting banners are listed. */
  stacked?: boolean;
  onMore?: () => void;
  onDismiss?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-feedback:p1
export function InlineBanner({ banner: b, more, stacked, onMore, onDismiss }: InlineBannerProps) {
  const sev = b.severity;
  const working = b.actions?.some((a) => a.loading);
  const dismissible = b.dismissible ?? (sev === "info" || sev === "success");
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-user-banner
  const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onDismiss?.();
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-user-banner
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-show-banner
  return (
    <div
      data-component="cpt-noter-component-ui-inline-banner"
      data-variant={(b.compact ? "compact-" : "") + sev}
      data-state={working ? "working" : stacked ? "stacked" : "shown"}
      className={cx("np-banner", `np-banner--${sev}`, b.compact && "is-compact")}
      role={sev === "error" ? "alert" : "status"}
    >
      <span className="np-banner__icon">
        <Icon name={SEV_ICON[sev]} size={15} />
      </span>
      <div className="np-banner__main">
        {b.title && <div className="np-banner__title">{b.title}</div>}
        <div className="np-banner__text">{b.text}</div>
        {b.progress != null && (
          <div className="np-banner__prog">
            <Progress value={b.progress} label={b.text} />
            <span className="np-tnum">{`${Math.max(0, Math.min(100, b.progress))} %`}</span>
          </div>
        )}
      </div>
      <div className="np-banner__actions">
        {b.actions?.slice(0, 3).map((a) =>
          a.link ? <Link key={a.label} label={a.label} onAction={a.onAction} /> : <PushButton key={a.label} label={a.label} size="small" variant={a.variant} loading={a.loading} onAction={a.onAction} />,
        )}
        {!!more && <PushButton label={`+${more} More`} size="small" variant="quiet" expanded={!!stacked} onAction={onMore} />}
        {dismissible && <IconButton icon="x" label="Dismiss" size="inline" onAction={onDismiss} onKeyDown={onEsc} />}
      </div>
    </div>
  );
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-show-banner
}

/** What a slot shows: the first banner, how many wait behind it, and the listed ones while **+N More** is open. */
export function slotView(banners: readonly Banner[], dismissed: ReadonlySet<string>, open: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-order
  const { first, rest, more } = orderBanners(visibleBanners(banners, dismissed));
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-order
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-if-more
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-list-more
  return { first, more, list: open ? rest : [] };
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-list-more
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-if-more
}

export interface BannerSlotProps {
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-receive
  banners: readonly Banner[];
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-receive
  /** The layout region, such as MW-R5. */
  region?: string;
  /** For app-level banners the owner also sends banner_dismiss. */
  onDismiss?: (id: string) => void;
}

// @cpt-flow:cpt-noter-flow-ui-primitives-banner:p1
export function BannerSlot({ banners, region, onDismiss }: BannerSlotProps) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  // a banner that left the slot shows again when its event happens again
  const kept = pruneDismissed(dismissed, banners);
  if (kept !== dismissed) setDismissed(kept);
  const { first, more, list } = slotView(banners, kept, open);
  if (open && !more) setOpen(false); // nothing waits any more: the list closes, and later banners arrive collapsed
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-if-dismiss
  const dismiss = (id: string) => {
    // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-dismiss
    setDismissed(new Set(kept).add(id));
    onDismiss?.(id);
    // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-dismiss
  };
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-if-dismiss
  // @cpt-begin:cpt-noter-flow-ui-primitives-banner:p1:inst-return-slot
  if (!first) return null;
  return (
    <div className="np-bannerslot" data-region={region}>
      <InlineBanner banner={first} more={more} stacked={open} onMore={() => setOpen(!open)} onDismiss={() => dismiss(first.id)} />
      {list.map((b) => (
        <InlineBanner key={b.id} banner={b} onDismiss={() => dismiss(b.id)} />
      ))}
    </div>
  );
  // @cpt-end:cpt-noter-flow-ui-primitives-banner:p1:inst-return-slot
}
