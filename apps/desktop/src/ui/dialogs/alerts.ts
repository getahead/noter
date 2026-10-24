// The native alerts of the M1 dialogs: their strings come from the catalogue, the alert itself is drawn by macOS
// through the dialog plugin (DESIGN 3.2 › Alerts). Cancel is the safe button, the one Return and Esc choose.
import { nativeAsk } from "../../core/tauri-transport";
import { t } from "../../i18n/format";

export interface AlertSpec {
  title: string;
  message: string;
  cancel: string;
  confirm: string;
  destructive: boolean;
}

/** Asks the dialog plugin; resolves true when `confirm` was chosen. */
export type Ask = (o: Parameters<typeof nativeAsk>[0]) => Promise<boolean>;

// @cpt-algo:cpt-noter-algo-ui-dialogs-host-delete-alert:p1
export function deleteAlert(calls: { id: string; title: string }[]): AlertSpec {
  const cancel = t("dialogs.cancel");
  // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-if-one
  if (calls.length === 1) {
    // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-one
    // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-script
    return {
      title: t("dialogs.delete_call.title", { title: calls[0]!.title }),
      message: t("dialogs.delete_call.message"),
      cancel,
      confirm: t("dialogs.delete_call.confirm"),
      destructive: true,
    };
    // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-script
    // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-one
  }
  // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-if-one
  // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-else-many
  // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-many
  const count = calls.length;
  // @cpt-begin:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-return-alert
  return {
    title: t("dialogs.delete_calls.title", { count }),
    message: t("dialogs.delete_calls.message"),
    cancel,
    confirm: t("dialogs.delete_calls.confirm", { count }),
    destructive: true,
  };
  // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-return-alert
  // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-many
  // @cpt-end:cpt-noter-algo-ui-dialogs-host-delete-alert:p1:inst-else-many
}

// @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert
/** The quit-while-recording strings; the core draws the alert and reads them from the catalogue. */
export const quitAlert = (callTitle: string): AlertSpec => ({
  title: t("dialogs.quit.title", { title: callTitle }),
  message: t("dialogs.quit.message"),
  cancel: t("dialogs.cancel"),
  confirm: t("dialogs.quit.confirm"),
  destructive: false,
});
// @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert

// @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-request-alert
/** Shows the alert and answers whether the user chose the confirm button; a dialog that cannot be shown counts as Cancel. */
export const askAlert = (
  a: AlertSpec,
  ask: Ask = nativeAsk,
): Promise<boolean> =>
  ask({
    title: a.title,
    message: a.message,
    kind: a.destructive ? "warning" : "info",
    okLabel: a.confirm,
    cancelLabel: a.cancel,
  }).catch(() => false);
// @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-request-alert
