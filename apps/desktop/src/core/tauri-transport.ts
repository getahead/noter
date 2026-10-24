// The real transport: Tauri 2 IPC. Hand-written, tiny, and the only file in the UI
// that imports @tauri-apps/api (DESIGN › Core bridge: only the bridge calls the core).
//
// Wire convention (DESIGN-core 3.3): every command takes one `args` object;
// subscribing commands also take a `channel` (a Tauri Channel). Errors reject
// with a serialized `CoreError`; Tauri's own plain-string rejections (capability
// denied, unreadable args) are mapped to `window_not_allowed` and `invalid_input`
// by `toCoreError` in the generated client, which also buffers Channel messages
// until the subscribing `invoke` resolves and sends `stream_ack`.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { CommandName, EventName, Transport } from "./bindings";

// @cpt-component:cpt-noter-component-app-core-bridge:p1
export const tauriTransport: Transport = {
  invoke(cmd: CommandName, args: unknown, onMessage?: (message: unknown) => void) {
    if (onMessage) {
      const channel = new Channel<unknown>();
      channel.onmessage = onMessage;
      return invoke(cmd, { args, channel });
    }
    return invoke(cmd, { args });
  },
  async listen(event: EventName, handler: (payload: unknown) => void) {
    return listen<unknown>(event, (e) => handler(e.payload));
  },
};

/** The dialog plugin's native alert (macOS draws it); resolves true when the OK button was chosen. */
export const nativeAsk = (o: { title: string; message: string; kind: "info" | "warning"; okLabel: string; cancelLabel: string }): Promise<boolean> => invoke<boolean>("plugin:dialog|ask", o);
