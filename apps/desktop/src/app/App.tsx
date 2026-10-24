import "./app.css";
import { useSyncExternalStore } from "react";
import { CallWindow } from "../features/call-window/call-window";
import { SettingsWindow } from "../features/settings/SettingsWindow";
import { FirstRun } from "../features/first-run/first-run";
import { MainWindow } from "../features/shell/main-window";
import { StoredTranscriptRoute } from "../features/transcript/hosts";
import { t } from "../i18n/format";
import { InlineBanner } from "../ui/feedback/inline-banner";
import { LiveRegions } from "./a11y/LiveRegions";
import type { Bridge } from "./bridge/bridge";
import { useWindow } from "./use-window";

/** The window's frame: renders only from its store. The main window mounts its shell; the other windows mount their screens. */
export function App({ bridge }: { bridge: Bridge }) {
  const status = useWindow(bridge, (s) => s.status);
  const error = useWindow(bridge, (s) => s.error);
  const stored = useTranscriptRoute();
  return (
    <div data-region="window" data-window={bridge.label} data-state={status.toLowerCase()} aria-busy={status === "LOADING"}>
      <LiveRegions />
      {/* the section-level error is an inline banner at the top of the window, not a placeholder (MB-2) */}
      {error && (
        <section data-region="section-error">
          <InlineBanner banner={{ id: "window-error", severity: "error", text: t("window.error"), actions: error.tryAgain ? [{ label: t("action.try_again"), onAction: () => void bridge.open() }] : [] }} />
        </section>
      )}
      {bridge.label === "main" && !error && (stored ? <StoredTranscriptRoute bridge={bridge} callId={stored} /> : <MainWindow bridge={bridge} />)}
      {bridge.label === "first-run" && !error && <FirstRun bridge={bridge} />}
      {bridge.label === "settings" && status === "READY" && <SettingsWindow bridge={bridge} />}
      {bridge.label === "call-screen" && (status === "READY" || status === "RESYNCING") && <CallWindow bridge={bridge} />}
    </div>
  );
}

/** Dev server only: `#transcript=<call id>` shows that call's stored transcript in the main window (the E2E reach it this way until the call page, 2.14, lands). */
const readRoute = () => (import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.hash.slice(1)).get("transcript")) || null;
const onHash = (on: () => void) => (addEventListener("hashchange", on), () => removeEventListener("hashchange", on));
// an external store: React re-reads the hash once subscribed, so a hash set right after the first render is not lost
const useTranscriptRoute = () => useSyncExternalStore(onHash, readRoute, readRoute);
