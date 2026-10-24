// The dialogs host (cpt-noter-component-screen-dialogs): the sheet layer under the window's toolbar and the hooks
// every feature uses to open a registered sheet or ask a native alert. Popovers are the primitive's own host.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { askAlert, type AlertSpec } from "./alerts";
import { DeleteOldAudioSheet } from "./delete-old-audio-sheet";
import { createSheets, type Sheets } from "./sheets";

const Ctx = createContext<Sheets | null>(null);

// @cpt-begin:cpt-noter-flow-ui-dialogs-host-sheet:p1:inst-open-host
export function DialogsProvider({
  children,
  sheets,
}: {
  children?: ReactNode;
  sheets?: Sheets;
}) {
  const host = useMemo(() => sheets ?? withM1Sheets(createSheets()), [sheets]);
  const open = useSyncExternalStore(host.subscribe, host.current, host.current);
  const Sheet = open && host.component(open.id);
  return (
    <Ctx.Provider value={host}>
      {children}
      {Sheet && <Sheet key={open.id} {...open.props} close={host.close} />}
    </Ctx.Provider>
  );
}
// @cpt-end:cpt-noter-flow-ui-dialogs-host-sheet:p1:inst-open-host

/** The sheets this feature delivers; features add theirs with `register`. */
function withM1Sheets(s: Sheets) {
  s.register("delete-old-audio", DeleteOldAudioSheet as never);
  return s;
}

/** `open(id, props)` shows a registered sheet; `register` adds one to the catalogue. */
export function useSheet() {
  const host = useContext(Ctx);
  if (!host) throw new Error("useSheet needs a DialogsProvider");
  return host;
}

/** Asks a native alert; focus returns to the control that asked once it is answered (Cancel on Return and Esc). */
export function useAlert() {
  return useCallback(async (alert: AlertSpec) => {
    const asker = document.activeElement as HTMLElement | null;
    const confirmed = await askAlert(alert);
    asker?.focus?.();
    return confirmed;
  }, []);
}
