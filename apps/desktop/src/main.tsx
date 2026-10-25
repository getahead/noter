// Bootstrap: one bridge and one store for this WebView window, over the Tauri transport, or over
// the fake core when VITE_FAKE_CORE is set (browser dev loop, screenshots, E2E).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens";

import { App } from "./app/App";
import { BridgeProvider } from "./app/bridge/context";
import { DialogsProvider } from "./ui/dialogs/host";
import { createBridge } from "./app/bridge/bridge";
import { COMMANDS, type WindowLabel } from "./core/bindings";
import { FakeCore } from "./core/fake/fake-core";
import { tauriTransport } from "./core/tauri-transport";
import { installTabNavigation, installUnobscure } from "./app/a11y/focus";
import "./features/library/register";
import { setPseudo, type Pseudo } from "./i18n/format";

const LABELS = COMMANDS.app_snapshot.windows as readonly WindowLabel[];

// @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-read-label
// The host opens each window at index.html?window=<label>; a plain browser defaults to the main window.
const asked = new URLSearchParams(location.search).get(
  "window",
) as WindowLabel | null;
const label: WindowLabel = asked && LABELS.includes(asked) ? asked : "main";
// @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-read-label

// @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-build-bridge
const bridge = createBridge(
  label,
  import.meta.env.VITE_FAKE_CORE
    ? new FakeCore({ window: label })
    : tauriTransport,
);
// @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-build-bridge

// @cpt-begin:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-user-closes
addEventListener("pagehide", () => void bridge.close());
// @cpt-end:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-user-closes

// ?pseudo=cyrillic|german turns on pseudo-localisation (the screenshot suite's string pass).
const pseudo = new URLSearchParams(location.search).get("pseudo");
if (pseudo === "cyrillic" || pseudo === "german")
  setPseudo(pseudo satisfies Pseudo);
installTabNavigation(document);
installUnobscure(document);

// @cpt-tech:cpt-noter-tech-ui-stack:p1
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BridgeProvider value={bridge}>
      <DialogsProvider>
        <App bridge={bridge} />
      </DialogsProvider>
    </BridgeProvider>
  </StrictMode>,
);
void bridge.open();
