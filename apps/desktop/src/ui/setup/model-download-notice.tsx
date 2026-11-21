import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { InlineBanner } from "../feedback/inline-banner";

// @cpt-dod:cpt-noter-dod-ui-first-run-models:p1
/** A skipped optional model has a named fallback and a path to its download. */
export function ModelDownloadNotice({ bridge, model }: { bridge: Bridge; model: "bge-m3" | "wespeaker" }) {
  const bundle = useWindow(bridge, (s) => s.whole?.setup?.models.bundles.find((b) => b.name === model));
  if (!bundle || bundle.state === "ready") return null;
  return <InlineBanner banner={{ id: model, severity: "info",
    text: t(model === "bge-m3" ? "models.missing_search" : "models.missing_speakers"),
    actions: [{ label: t("models.open_settings"), onAction: () => void bridge.act("window:navigate", "window_navigate",
      () => bridge.core.windowNavigate({ target: { type: "settings", pane: "models_and_runtimes" } })) }],
  }} />;
}
