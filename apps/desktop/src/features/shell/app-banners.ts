import type { BannerKind, CallId } from "../../core/bindings";
import { t } from "../../i18n/format";
import type { WholeSlices } from "../../app/store/window-store";
import type { Banner } from "../../ui/feedback/inline-banner";

/** What the banners' actions do; the shell wires each to its command. */
export interface BannerActions {
  runSelfTest(): void;
  finishSetup(): void;
  restartNow(): void;
  openCall(id: CallId): void;
  resumeRecording(id: CallId): void;
  /** `update_install` is running, or failed and can be tried again. */
  restart: { loading: boolean; tryAgain: boolean };
}

export const isBannerKind = (id: string): id is BannerKind => id === "recording_interrupted_by_quit" || id === "update_ready" || id === "roll_up_failed";

/** The title between “ ” in the quit banner, as DESIGN writes it. */
const quoted = (title: string) => `“${title}”`;

/**
 * The app-level banners MW-R5 shows, before the slot orders them (error, warning, degraded, info): the core's
 * `banners:changed` set, and the self-test notice, which the shell derives from the setup status because the
 * core sends no banner for it (the prototype's `bannerSlot()`).
 */
// @cpt-state:cpt-noter-state-ui-main-window-shell-banner-slot:p1
export function appBanners(whole: Pick<Partial<WholeSlices>, "banners" | "setup">, a: BannerActions): Banner[] {
  // @cpt-begin:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-fill-banner
  const out: Banner[] = [];
  for (const b of whole.banners?.banners ?? []) {
    if (b.type === "recording_interrupted_by_quit") {
      out.push({
        id: b.type,
        severity: "warning",
        dismissible: true,
        text: t("banner.quit_recording", { title: quoted(b.call.title) }),
        actions: [
          { label: t("banner.open_call"), onAction: () => a.openCall(b.call.id) },
          { label: t("banner.resume_recording"), variant: "primary", onAction: () => a.resumeRecording(b.call.id) },
        ],
      });
    } else if (b.type === "update_ready") {
      out.push({
        id: b.type,
        severity: "info",
        text: t("banner.update_ready", { version: b.version }),
        actions: [{ label: t(a.restart.tryAgain ? "action.try_again" : "banner.restart_now"), variant: "primary", loading: a.restart.loading, onAction: a.restartNow }],
      });
    } else {
      out.push({ id: b.type, severity: "warning", dismissible: true, text: t("banner.roll_up_failed") });
    }
  }
  const test = whole.setup?.self_test.type;
  if (test === "skipped" || test === "failed")
    out.push({
      id: "self-test",
      severity: "warning",
      text: t("banner.self_test"),
      actions: [
        { label: t("banner.run_self_test"), onAction: a.runSelfTest },
        { label: t("banner.finish_setup"), link: true, onAction: a.finishSetup },
      ],
    });
  return out;
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-fill-banner
}
