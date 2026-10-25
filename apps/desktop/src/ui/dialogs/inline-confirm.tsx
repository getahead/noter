import { useEffect, useRef } from "react";
import { t } from "../../i18n/format";
import { PushButton, type PushButtonProps } from "../primitives/push-button";

// @cpt-flow:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1
// @cpt-dod:cpt-noter-dod-ui-dialogs-host-inline:p1
/** The call window's two-step confirmation, in place of the capture notice's actions: never an alert or a sheet, focus on Back, no default button. */
export function InlineConfirm({
  onConfirm,
  onBack,
  size,
}: {
  onConfirm: () => void;
  onBack: () => void;
  size?: PushButtonProps["size"];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-inline
  useEffect(
    () =>
      ref.current?.parentElement
        ?.querySelector<HTMLElement>('button[data-back="true"]')
        ?.focus(),
    [],
  );
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-inline
  // @cpt-begin:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-return-inline
  return (
    <>
      <span ref={ref} className="cw-notice__confirm">
        {t("dialogs.discard.ask")}
      </span>
      {/* @cpt-begin:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-if-discard */}
      <PushButton
        label={t("dialogs.discard.confirm")}
        variant="destructive"
        size={size}
        onAction={onConfirm}
      />
      {/* @cpt-end:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-if-discard */}
      {/* @cpt-begin:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-else-back */}
      <PushButton
        label={t("dialogs.discard.back")}
        size={size}
        attrs={{ "data-back": "true" }}
        onAction={onBack}
      />
      {/* @cpt-end:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-else-back */}
    </>
  );
  // @cpt-end:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1:inst-return-inline
}
