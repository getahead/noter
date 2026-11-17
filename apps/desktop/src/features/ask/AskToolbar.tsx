// AK-R1: Ask's toolbar. The shell's toolbar with the scope pop-up (the presets the core offers).
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { PopupButton } from "../../ui/primitives/popup-button";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { useEffect } from "react";

import { ModeIndicator } from "../shell/mode-indicator-view";
import { modeIndicator } from "../shell/mode-indicator";
import { foldTurn, phaseOf } from "./model";
import { bindNewKey, newQuestion, setAskState, useAskState } from "./ask-state";

// @cpt-component:cpt-noter-component-screen-ask:p1
export function AskToolbar({ bridge, base }: PageToolbarProps) {
  const answering = useWindow(bridge, (s) => {
    const d = s.streams.ask_start;
    return !!d?.data && !d.error && phaseOf(foldTurn(d.data.messages)) === "streaming";
  });
  const { presets, scopeId } = useAskState();
  const privacy = useWindow(bridge, (s) => s.whole.privacy);
  const degraded = useWindow(bridge, (s) => s.whole.degraded);
  const mode = modeIndicator({ mode: privacy?.mode ?? "cloud_redacted", degraded: degraded?.states ?? [], sensitiveCall: false });
  const openPrivacy = () => void bridge.act("window:navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "settings", pane: "privacy" } }));
  const scope =
    presets.length > 0 ? (
      <PopupButton variant="toolbar" label={t("ask.scope")} options={presets.map((p) => ({ value: p.id, label: p.id === "all" ? t("ask.scope_all") : p.label }))} value={scopeId} onAction={(id) => setAskState({ scopeId: id })} />
    ) : undefined;
  useEffect(() => bindNewKey(document), []);
  return <MainToolbar {...base} region="AK-R1" title={t("ask.title")} subtitle={answering ? t("ask.answering") : undefined} actions={[{ label: t("ask.new_question"), onAction: newQuestion, primary: true }]} trailing={
      <>
        <ModeIndicator view={mode} variant={base.narrow ? "glyph" : "ask"} runtime={privacy?.mode === "local_only" ? "Local model" : "Claude Code"} onOpenPrivacy={openPrivacy} />
        {scope}
      </>
    } />;
}
