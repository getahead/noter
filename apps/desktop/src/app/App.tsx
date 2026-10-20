import "./app.css";
import { FirstRun } from "../features/first-run/first-run";
import { MainWindow } from "../features/shell/main-window";
import { t } from "../i18n/format";
import { InlineBanner } from "../ui/feedback/inline-banner";
import { LiveRegions } from "./a11y/LiveRegions";
import type { Bridge } from "./bridge/bridge";
import { useWindow } from "./use-window";

/** The window's frame: renders only from its store. The main window mounts its shell; the other windows mount their screens. */
export function App({ bridge }: { bridge: Bridge }) {
  const status = useWindow(bridge, (s) => s.status);
  const error = useWindow(bridge, (s) => s.error);
  return (
    <div data-region="window" data-window={bridge.label} data-state={status.toLowerCase()} aria-busy={status === "LOADING"}>
      <LiveRegions />
      {/* the section-level error is an inline banner at the top of the window, not a placeholder (MB-2) */}
      {error && (
        <section data-region="section-error">
          <InlineBanner banner={{ id: "window-error", severity: "error", text: t("window.error"), actions: error.tryAgain ? [{ label: t("action.try_again"), onAction: () => void bridge.open() }] : [] }} />
        </section>
      )}
      {bridge.label === "main" && !error && <MainWindow bridge={bridge} />}
      {bridge.label === "first-run" && !error && <FirstRun bridge={bridge} />}
    </div>
  );
}
