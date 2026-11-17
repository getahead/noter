// Add Person: the New person form in a popover under the toolbar's button, opened from there or from the empty state.
import { useState, useSyncExternalStore } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonRef } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Popover } from "../../ui/primitives/popover";
import { holdUndo } from "../history/undo";
import { NewPersonForm } from "../speakers/NewPersonForm";
import { usePeopleHeld } from "./count";
import { possibleDuplicate } from "./identity";

let open = false;
const listeners = new Set<() => void>();
export const setAddPerson = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
const useOpen = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => open, () => open);

// @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-create
/** Sends `person_create`; the core's change goes to the Undo strip. Whether it worked; a refusal keeps the form open. */
export async function createPerson(bridge: Bridge, ref: Extract<PersonRef, { type: "new" }>): Promise<boolean> {
  const res = await bridge.act("people:create", "person_create", () => bridge.core.personCreate({ display_name: ref.display_name, email: ref.email ?? null }), { screen: "people" });
  if (res.status === "error") return false;
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("people.added", { name: res.data.person.display_name }) });
  return true;
}
// @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-create

/** The popover itself; `anchor` is the toolbar's Add Person button. */
export function AddPersonPopover({ bridge, anchor }: { bridge: Bridge; anchor: HTMLElement | null }) {
  const shown = useOpen();
  const people = usePeopleHeld();
  const [failed, setFailed] = useState(false);
  if (!shown) return null;
  const close = () => (setFailed(false), setAddPerson(false));
  // @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-new-form
  return (
    <Popover variant="new-person-form" anchor={anchor} width={320} label={t("people.add_title")} onClose={close}>
      <div className="pe-add">
      <NewPersonForm
        variant="popover"
        confirmLabel={t("people.add_confirm")}
        initial=""
        people={people}
        findDuplicate={possibleDuplicate}
        backLabel={t("dialogs.cancel")}
        requireName
        error={failed ? t("people.add_error") : null}
        onPick={() => {}}
        onBack={close}
        onConfirm={async (ref, _name, isNew) => {
          if (!isNew && ref.type === "existing")
            return (close(), void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "person", person_id: ref.person_id } }), { screen: "people" }));
          if (ref.type !== "new") return;
          if (await createPerson(bridge, ref)) close();
          else setFailed(true);
        }}
      />
      </div>
    </Popover>
  );
  // @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-new-form
}
