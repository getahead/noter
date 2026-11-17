// AK-R1: Ask's toolbar. The shell's toolbar with the scope pop-up (the presets the core offers).
import { t } from "../../i18n/format";
import { PopupButton } from "../../ui/primitives/popup-button";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { setAskState, useAskState } from "./ask-state";

// @cpt-component:cpt-noter-component-screen-ask:p1
export function AskToolbar({ base }: PageToolbarProps) {
  const { presets, scopeId } = useAskState();
  const scope =
    presets.length > 0 ? (
      <PopupButton variant="toolbar" label={t("ask.scope")} options={presets.map((p) => ({ value: p.id, label: p.label }))} value={scopeId} onAction={(id) => setAskState({ scopeId: id })} />
    ) : undefined;
  return <MainToolbar {...base} region="AK-R1" title={t("ask.title")} trailing={scope} />;
}
