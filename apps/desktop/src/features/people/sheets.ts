// Registers People's sheets with the dialogs host and opens them.
import { useEffect } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { askAlert } from "../../ui/dialogs/alerts";
import { useSheet } from "../../ui/dialogs/host";
import { EditPersonSheet } from "./EditPersonSheet";
import { MergePeopleSheet } from "./MergePeopleSheet";
import { deletePerson } from "./actions";
import { leave } from "./leave";

/** Both identity sheets, available to the page and its toolbar. */
export function usePeopleSheets() {
  const sheets = useSheet();
  useEffect(() => {
    sheets.register("person-edit", EditPersonSheet as never);
    sheets.register("person-merge", MergePeopleSheet as never);
  }, [sheets]);
  return sheets;
}

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-delete-alert
/** The native alert; Cancel is the default. A failed delete keeps the person and says so. Resolves whether the person is gone. */
export async function confirmDelete(bridge: Bridge, p: PersonRow, onFailed: (text: string) => void, ask = askAlert): Promise<boolean> {
  const confirmed = await ask({ title: t("person.delete.title", { name: p.short_name }), message: t("person.delete.message"), cancel: t("dialogs.cancel"), confirm: t("person.delete.confirm"), destructive: true });
  if (!confirmed) return false;
  if (await deletePerson(bridge, p.id)) return (leave.toPeople?.(), true);
  onFailed(t("person.delete.err", { name: p.short_name }));
  return false;
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-delete-alert
