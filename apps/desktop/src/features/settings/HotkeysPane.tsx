import { useEffect, useRef } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { HotkeyAction } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { PushButton } from "../../ui/primitives/push-button";
import { Toggle } from "../../ui/primitives/toggle";
import { modifierCaps, toAccelerator } from "./accelerator";
import { loadHotkeys, resetHotkeys, saveSection, setHotkey, useRowError, type HotkeyAnswer } from "./actions";
import { Group, Row } from "./form";
import { cardKeyRows } from "./card-keys";
import { cardKeyConflictCaps, hotkeyRows, undoRow } from "./hotkey-rows";
import { HotkeyRecorder } from "./HotkeyRecorder";

const RESTORE_KEY = "hotkeys:reset";

// @cpt-dod:cpt-noter-dod-ui-settings-hotkeys:p1
// @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-open-hotkeys
export function HotkeysPane({ bridge }: { bridge: Bridge }) {
  // the pane opening asks the core to test-register the set again, so each row's result is fresh
  // (the ref keeps StrictMode's second effect run from asking twice)
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current) void loadHotkeys(bridge);
    asked.current = true;
  }, [bridge]);
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-open-hotkeys
  const list = useWindow(bridge, (s) => s.whole.hotkeys);
  const settings = useWindow(bridge, (s) => s.whole.settings);
  const cardConflicts = useWindow(bridge, (s) => s.whole.copilot?.card_keys.conflicts);
  const listFailed = useWindow(bridge, (s) => s.commands["hotkeys:list"]?.state === "ERROR" && !s.whole.hotkeys);
  const copilotError = useRowError(bridge, "copilot");
  const restoring = useWindow(bridge, (s) => s.commands[RESTORE_KEY]?.state === "WAITING");
  if (!settings) return null;

  const copilot = settings.copilot;
  const [pin, dismiss] = cardKeyRows(copilot);
  const undo = undoRow(list);
  const record = (action: HotkeyAction) => async ({ code, modifiers }: { code: string; modifiers: Parameters<typeof toAccelerator>[1] }): Promise<HotkeyAnswer> => {
    const shortcut = toAccelerator(code, modifiers);
    return shortcut ? setHotkey(bridge, action, shortcut) : { ok: false, message: t("settings.hotkeys.unsupported") };
  };
  const clear = (action: HotkeyAction) => () => setHotkey(bridge, action, null);
  const cardKeys = (edits: Parameters<typeof saveSection<"copilot">>[2]) => saveSection(bridge, "copilot", edits);
  const recordModifiers = async ({ modifiers: m }: { modifiers: { control: boolean; option: boolean; command: boolean } }): Promise<HotkeyAnswer> => {
    const res = await cardKeys({ card_keys: { modifiers: { control: m.control, option: m.option, command: m.command } } });
    return res?.status === "ok" ? { ok: true } : { ok: false, message: t("settings.error.rejected") };
  };

  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-render-hotkeys
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-return-hotkeys
  return (
    <>
      {listFailed && (
        <InlineBanner banner={{ id: "hotkeys-list", severity: "error", text: t("settings.error.hotkeys_read"), actions: [{ label: t("action.try_again"), onAction: () => void bridge.retry("hotkeys:list") }] }} />
      )}
      <Group title={t("settings.hotkeys.global")}>
        {hotkeyRows(list).map((r) => (
          <HotkeyRecorder key={r.action} id={`hk-${r.action}`} label={t(r.label)} caps={r.caps} conflict={r.conflict} onRecord={record(r.action)} onClear={clear(r.action)} />
        ))}
      </Group>
      <Group
        title={t("settings.hotkeys.card_keys")}
        foot={
          <>
            <span className="np-dim">{t("settings.hotkeys.footnote")}</span>
            <span className="np-tb__spacer" />
            <PushButton label={t("settings.hotkeys.restore")} loading={restoring} onAction={() => void resetHotkeys(bridge)} />
          </>
        }
      >
        <Row label={t("settings.hotkeys.use_card_keys")} error={copilotError}>
          <Toggle on={copilot.card_keys.enabled} size="small" ariaLabel={t("settings.hotkeys.use_card_keys")} onAction={(enabled) => void cardKeys({ card_keys: { enabled } })} />
        </Row>
        <HotkeyRecorder id="hk-pin" variant="modifier-set" label={t("settings.hotkeys.pin")} caps={modifierCaps(pin!.modifiers!)} disabled={pin!.disabled} onRecord={recordModifiers} />
        {cardKeyConflictCaps(cardConflicts).map((caps) => (
          <div key={caps} className="st-conflict">
            <Icon name="warning" size={12} />
            {t("settings.hotkeys.card_conflict", { chord: caps })}
          </div>
        ))}
        <Row label={t("settings.hotkeys.dismiss_keys")} error={copilotError}>
          <Toggle on={copilot.dismiss_with_keys} size="small" disabled={!copilot.card_keys.enabled} ariaLabel={t("settings.hotkeys.dismiss_keys")} onAction={(v) => void saveSection(bridge, "copilot", { dismiss_with_keys: v })} />
        </Row>
        <HotkeyRecorder id="hk-dismiss" variant="derived" label={t("settings.hotkeys.dismiss")} caps={modifierCaps(dismiss!.modifiers!)} disabled={dismiss!.disabled} />
        {undo && <HotkeyRecorder id="hk-undo" label={t("settings.hotkeys.undo")} caps={undo.caps} conflict={undo.conflict} disabled={!copilot.card_keys.enabled} onRecord={record("undo_card_action")} onClear={clear("undo_card_action")} />}
      </Group>
      <p className="st-hint">{t("settings.hotkeys.vo_note")}</p>
    </>
  );
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-return-hotkeys
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-render-hotkeys
}
