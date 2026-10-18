// Banner slot logic of the inline banner (docs/features/ui/primitives.md): which banner a slot shows,
// what waits behind **+N More**, dismissal, and the banner's state machine. Pure, so the slot component
// and the unit tests share it.

export type Severity = "error" | "warning" | "degraded" | "info" | "success";
/** Most severe first. */
export const SEVERITIES: readonly Severity[] = ["error", "warning", "degraded", "info", "success"];

// @cpt-algo:cpt-noter-algo-ui-primitives-order-banners:p1
export function orderBanners<B extends { severity: Severity }>(banners: readonly B[]): { first: B | null; rest: B[]; more: number } {
  // @cpt-begin:cpt-noter-algo-ui-primitives-order-banners:p1:inst-sort-severity
  // @cpt-begin:cpt-noter-algo-ui-primitives-order-banners:p1:inst-keep-order
  // Array.prototype.sort is stable, so banners of one severity keep the order the core sent
  const sorted = [...banners].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  // @cpt-end:cpt-noter-algo-ui-primitives-order-banners:p1:inst-keep-order
  // @cpt-end:cpt-noter-algo-ui-primitives-order-banners:p1:inst-sort-severity
  // @cpt-begin:cpt-noter-algo-ui-primitives-order-banners:p1:inst-return-first
  const [first = null, ...rest] = sorted;
  return { first, rest, more: rest.length };
  // @cpt-end:cpt-noter-algo-ui-primitives-order-banners:p1:inst-return-first
}

/** The banners not dismissed by the user. */
export function visibleBanners<B extends { id: string }>(banners: readonly B[], dismissed: ReadonlySet<string>): B[] {
  return banners.filter((b) => !dismissed.has(b.id));
}

/** Drops the dismissals of banners that left the slot, so a banner shows again when its event happens again.
 *  Returns the same set when nothing changed, so a React state update can bail out. */
export function pruneDismissed(dismissed: ReadonlySet<string>, banners: readonly { id: string }[]): ReadonlySet<string> {
  const ids = new Set(banners.map((b) => b.id));
  const kept = [...dismissed].filter((id) => ids.has(id));
  return kept.length === dismissed.size ? dismissed : new Set(kept);
}

// @cpt-state:cpt-noter-state-ui-primitives-inline-banner:p1
export type BannerState = "SHOWN" | "WORKING" | "STACKED" | "DISMISSED" | "RESOLVED";
/** action: the owner's command runs; failed: it failed and the cause remains; more/less: **+N More** opens/closes;
 *  dismiss: × or Esc on ×; resolved: the core reports the fix and the owner removes the banner. */
export type BannerEvent = "action" | "failed" | "more" | "less" | "dismiss" | "resolved";

const NEXT: Partial<Record<BannerState, Partial<Record<BannerEvent, BannerState>>>> = {
  SHOWN: {
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-working
    action: "WORKING",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-working
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-stacked
    more: "STACKED",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-stacked
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-dismissed
    dismiss: "DISMISSED",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-dismissed
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-resolved
    resolved: "RESOLVED",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-shown-resolved
  },
  WORKING: {
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-working-shown
    failed: "SHOWN",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-working-shown
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-working-resolved
    resolved: "RESOLVED",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-working-resolved
  },
  STACKED: {
    // @cpt-begin:cpt-noter-state-ui-primitives-inline-banner:p1:inst-stacked-shown
    less: "SHOWN",
    // @cpt-end:cpt-noter-state-ui-primitives-inline-banner:p1:inst-stacked-shown
  },
};

/** The next state; an event that is no transition of `state`, or a dismiss of a banner that cannot be dismissed
 *  (warning, error, degraded), leaves it as it is. */
export function bannerNext(state: BannerState, event: BannerEvent, dismissible: boolean): BannerState {
  if (event === "dismiss" && !dismissible) return state;
  return NEXT[state]?.[event] ?? state;
}
