// **Sign Out…** on an account row: the alert of the prototype as a sheet, because the native dialog has no
// checkbox. Cancel is the Esc button, **Sign Out** the default; the CLI stays signed in unless the box is ticked.
import { useState } from "react";

import type { AccountProvider, AgentRef } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { signOutCopy } from "./account-rows";

export function SignOutSheet({ provider, agents, keyConfigured, onConfirm, onCancel }: { provider: AccountProvider; agents: AgentRef[]; keyConfigured: boolean; onConfirm: (alsoInCli: boolean) => void; onCancel: () => void }) {
  const [also, setAlso] = useState(false);
  const copy = signOutCopy(provider, agents, keyConfigured);
  return (
    <Sheet title={copy.title} width={480} onCancel={onCancel} onDefault={() => onConfirm(also)}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{copy.title}</div>
        <div className="np-sheet__sub">{copy.message}</div>
      </div>
      <div className="np-sheet__body">
        <Checkbox label={copy.checkbox} checked={also} onAction={setAlso} />
      </div>
      <SheetFooter defaultButton={<PushButton label={t("settings.accounts.signout_confirm")} variant="primary" onAction={() => onConfirm(also)} />}>
        <PushButton label={t("dialogs.cancel")} onAction={onCancel} />
      </SheetFooter>
    </Sheet>
  );
}
