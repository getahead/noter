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
import { recentChoices } from "./actions";
import { bindNewKey, newQuestion, requestOpen, setAskState, useAskState } from "./ask-state";

// @cpt-component:cpt-noter-component-screen-ask:p1
export function AskToolbar({ bridge, base }: PageToolbarProps) {
  const answering = useWindow(bridge, (s) => {
    const d = s.streams.ask_start;
    return !!d?.data && !d.error && phaseOf(foldTurn(d.data.messages)) === "streaming";
  });
  const { presets, scopeId, recent } = useAskState();
  const privacy = useWindow(bridge, (s) => s.whole.privacy);
  const degraded = useWindow(bridge, (s) => s.whole.degraded);
  const mode = modeIndicator({ mode: privacy?.mode ?? "cloud_redacted", degraded: degraded?.states ?? [], sensitiveCall: false });
  const openPrivacy = () => void bridge.act("window:navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "settings", pane: "privacy" } }));
  // Medium and Narrow: the Recent pane's place (the pane and this pop-up swap by the window's width class, in ask.css)
  const recentPop = <PopupButton variant="toolbar" cls="ak-recent-pop" label={t("ask.recent")} options={recentChoices(recent, t("ask.recent_short"))} value="" onAction={(id) => id && requestOpen(id)} />;
  // Narrow: the scope moves into the » menu first (the mode indicator stays)
  const scopeActions = base.narrow ? presets.map((p) => ({ label: `${t("ask.scope")}: ${p.id === "all" ? t("ask.scope_all") : p.label}`, checked: p.id === scopeId, onAction: () => setAskState({ scopeId: p.id }) })) : [];
  const scope =
    presets.length > 0 && !base.narrow ? (
      <PopupButton variant="toolbar" label={t("ask.scope")} options={presets.map((p) => ({ value: p.id, label: p.id === "all" ? t("ask.scope_all") : p.label }))} value={scopeId} onAction={(id) => setAskState({ scopeId: id })} />
    ) : undefined;
  useEffect(() => bindNewKey(document), []);
  return <MainToolbar {...base} region="AK-R1" title={t("ask.title")} subtitle={answering ? t("ask.answering") : undefined} actions={[{ label: t("ask.new_question"), onAction: newQuestion }, ...scopeActions]} trailing={
      <>
        <ModeIndicator view={mode} variant={base.narrow ? "glyph" : "ask"} runtime={t(privacy?.mode === "local_only" ? "ask.runtime_local" : "ask.runtime_claude_code")} onOpenPrivacy={openPrivacy} />
        {recentPop}
        {scope}
      </>
    } />;
}
