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
  /** **Try Again** on a failed command of the frame: the bridge runs it again only for a retryable error. */
  retry(key: string): void;
}

/** The frame's commands whose failure shows in MW-R5 (`update_install` keeps its own **Try Again** on the update banner). */
const FRAME_COMMANDS = ["window_navigate", "window_show_call", "capture_resume_interrupted", "banner_dismiss"] as const;

export interface CommandFailure {
  key: string;
  tryAgain: boolean;
}

/** The frame's commands that ended in an error, in a fixed order. */
export function commandFailures(commands: Record<string, { state: string; error: { tryAgain: boolean } | null }>): CommandFailure[] {
  return FRAME_COMMANDS.flatMap((key) => (commands[key]?.state === "ERROR" ? [{ key, tryAgain: commands[key].error?.tryAgain === true }] : []));
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
export function appBanners(whole: Pick<Partial<WholeSlices>, "banners" | "setup">, a: BannerActions, failures: readonly CommandFailure[] = []): Banner[] {
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
  // a failed command shows where the user acts, never silently (the slot's × clears it; running the command again brings it back if it fails again)
  for (const f of failures)
    out.push({
      id: `error:${f.key}`,
      severity: "error",
      dismissible: true,
      text: t("banner.command_failed"),
      actions: f.tryAgain ? [{ label: t("action.try_again"), onAction: () => a.retry(f.key) }] : [],
    });
  return out;
  // @cpt-end:cpt-noter-flow-ui-main-window-shell-app-state:p1:inst-fill-banner
}
