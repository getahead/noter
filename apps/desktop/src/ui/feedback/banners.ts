// Pure banner-slot logic (docs/features/ui/primitives.md): ordering, visibility and dismissal bookkeeping.
// The component owns its rendered state; this module keeps the slot calculations easy to test.

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

/** A dismissal the owner's command refused is taken back, so the banner shows again. Returns the same set when it held no such id. */
export function restoreDismissed(dismissed: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!dismissed.has(id)) return dismissed;
  const next = new Set(dismissed);
  next.delete(id);
  return next;
}
