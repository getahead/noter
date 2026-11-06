// PC-R2's review banner: how many suggested items wait before the call is shared, with Start Review and Accept All.
// The count is the suggestions of this call in the store, read once from `items_list` when the page opens.
import { useEffect } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import type { Banner } from "../../ui/feedback/inline-banner";
import { loadItems, reviewAll } from "./actions";

const asked = new WeakMap<Bridge, Set<string>>();

/** Focus the first suggested row in the order the rows are on the page (**Start Review**). */
export function startReview(): boolean {
  const first = globalThis.document?.querySelector<HTMLElement>('[data-item-id][data-review="suggested"]');
  first?.focus();
  return !!first;
}

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** The banner for `callId`, or null with nothing to review; the first call reads the call's items. */
export function useReviewBanner(bridge: Bridge, callId: string): Banner | null {
  const waiting = useWindow(bridge, (s) => Object.values(s.entities.item).filter((i) => i.call.id === callId && i.review === "suggested").length);
  useEffect(() => {
    const seen = asked.get(bridge) ?? asked.set(bridge, new Set()).get(bridge)!;
    if (!seen.has(callId)) void loadItems(bridge, callId), seen.add(callId);
  }, [bridge, callId]);
  if (!waiting) return null;
  return {
    id: "review",
    severity: "info",
    dismissible: false,
    text: t("items.banner", { count: waiting }),
    actions: [
      { label: t("items.start_review"), onAction: () => void startReview() },
      { label: t("items.accept_all"), onAction: () => void reviewAll(bridge, callId, []) },
    ],
  };
}
