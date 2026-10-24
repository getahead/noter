import { useEffect, useRef } from "react";
import { t } from "../../i18n/format";
import { PushButton } from "../primitives/push-button";

// @cpt-flow:cpt-noter-flow-ui-dialogs-host-inline-confirm:p1
/** The call window's two-step confirmation, in place of the capture notice's actions: never an alert or a sheet, focus on Back, no default button. */
export function InlineConfirm({
  onConfirm,
  onBack,
}: {
  onConfirm: () => void;
  onBack: () => void;
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
  return (
    <>
      <span ref={ref} className="cw-notice__confirm">
        {t("dialogs.discard.ask")}
      </span>
      <PushButton
        label={t("dialogs.discard.confirm")}
        variant="destructive"
        onAction={onConfirm}
      />
      <PushButton
        label={t("dialogs.discard.back")}
        attrs={{ "data-back": "true" }}
        onAction={onBack}
      />
    </>
  );
}
