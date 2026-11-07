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

const pendingReview = new WeakMap<Bridge, { callId: string; at: number }>();
/** A review request not honoured within this long (the call never opened, or had no rows) is dropped. */
const PENDING_MS = 10_000;

/** Today opens Summary and asks for Start Review; the call page applies it once its suggested rows are on the page. */
export async function openReview(bridge: Bridge, callId: string) {
  pendingReview.set(bridge, { callId, at: Date.now() });
// @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-links
  const result = await bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: callId, tab: "summary" } }), { screen: "main-window-shell" });
// @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-links
  if (result.status !== "ok") pendingReview.delete(bridge);
}

/** Applies a pending Start Review for `callId`; true when nothing is left to do (applied, none pending, expired or meant for another call), false to try again once the rows render. */
export function applyPendingReview(bridge: Bridge, callId: string): boolean {
  const pending = pendingReview.get(bridge);
  if (!pending) return true;
  if (pending.callId !== callId || Date.now() - pending.at > PENDING_MS) {
    pendingReview.delete(bridge);
    return true;
  }
  if (!startReview()) return false;
  pendingReview.delete(bridge);
  return true;
}

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** The banner for `callId`, or null with nothing to review; opening a call reads its items. */
export function useReviewBanner(bridge: Bridge, callId: string): Banner | null {
  const waiting = useWindow(bridge, (s) => Object.values(s.entities.item).filter((i) => i.call.id === callId && i.review === "suggested").length);
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (applyPendingReview(bridge, callId) || ++tries > 30) return;
      frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [bridge, callId, waiting]);
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
