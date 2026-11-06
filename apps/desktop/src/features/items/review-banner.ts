// PC-R2's review banner: how many suggested items wait before the call is shared, with Start Review and Accept All.
// The count is the suggestions of this call in the store, refreshed from `items_list` when the page opens.
import { useEffect } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import type { Banner } from "../../ui/feedback/inline-banner";
import { errorText, loadItems, reviewAll } from "./actions";

/** Focus the first suggested row in the order the rows are on the page (**Start Review**). */
export function startReview(): boolean {
  const first = globalThis.document?.querySelector<HTMLElement>('[data-item-id][data-review="suggested"]');
  first?.focus();
  return !!first;
}

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** The banner for `callId`, or null with nothing to review; opening a call reads its items. */
export function useReviewBanner(bridge: Bridge, callId: string): Banner | null {
  const waiting = useWindow(bridge, (s) => Object.values(s.entities.item).filter((i) => i.call.id === callId && i.review === "suggested").length);
  const list = useWindow(bridge, (s) => s.commands[`items:list:${callId}`]);
  const batch = useWindow(bridge, (s) => s.commands[`items:review_all:${callId}`]);
  useEffect(() => {
    void loadItems(bridge, callId);
  }, [bridge, callId]);
  if (list?.error) return {
    id: "review",
    severity: "error",
    dismissible: false,
    text: errorText(list.error.code ?? "internal"),
    actions: [{ label: t("action.try_again"), onAction: () => void loadItems(bridge, callId) }],
  };
  if (!waiting) return null;
  return {
    id: "review",
    severity: batch?.error ? "error" : "info",
    dismissible: false,
    text: batch?.error ? errorText(batch.error.code ?? "internal") : t("items.banner", { count: waiting }),
    actions: [
      { label: t("items.start_review"), onAction: () => void startReview() },
      { label: t(batch?.error ? "action.try_again" : "items.accept_all"), loading: batch?.state === "WAITING", onAction: () => void reviewAll(bridge, callId, []) },
    ],
  };
}
