import { useSyncExternalStore } from "react";

import { Msg } from "../i18n/Msg";
import { LiveRegions } from "./a11y/LiveRegions";
import type { Bridge } from "./bridge/bridge";
import type { WindowState } from "./store/window-store";

/** Read a value of the window store and re-render when it changes (the same value on the server). */
function useWindow<T>(bridge: Bridge, pick: (s: WindowState) => T): T {
  const get = () => pick(bridge.store.getState());
  return useSyncExternalStore(bridge.store.subscribe, get, get);
}

/** The window's frame: renders only from its store. Screens mount inside it (main-window shell and the rest). */
export function App({ bridge }: { bridge: Bridge }) {
  const status = useWindow(bridge, (s) => s.status);
  const error = useWindow(bridge, (s) => s.error);
  return (
    <div data-region="window" data-window={bridge.label} data-state={status.toLowerCase()} aria-busy={status === "LOADING"}>
      <LiveRegions />
      {error && (
        <section role="alert" data-region="section-error">
          <p>
            <Msg id="window.error" />
          </p>
          {error.tryAgain && (
            <button type="button" onClick={bridge.open}>
              <Msg id="action.try_again" />
            </button>
          )}
        </section>
      )}
    </div>
  );
}
