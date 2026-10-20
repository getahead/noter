import type { HotkeyAction } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PopupButton } from "../../ui/primitives/popup-button";
import { Toggle } from "../../ui/primitives/toggle";
import { saveSection } from "./actions";
import { Group, Row } from "./form";
import { choices, type PaneProps } from "./pane-props";

const LAYOUT = choices({ auto: "settings.call.layout_auto", floating: "settings.call.layout_floating" });
const TITLE = choices({ none: "settings.call.menu_title_none", elapsed_time: "settings.call.menu_title_elapsed", newest_card: "settings.call.menu_title_card" });
const QUICK: { action: HotkeyAction; label: string }[] = [
  { action: "pause", label: t("settings.hotkey.pause") },
  { action: "mark_moment", label: t("settings.hotkey.mark_moment") },
  { action: "catch_me_up", label: t("settings.hotkey.catch_me_up") },
  { action: "mute_copilot", label: t("settings.hotkey.mute_copilot") },
];

export function CallScreenPane({ bridge, settings }: PaneProps) {
  const { call_screen: call, menu_bar: bar } = settings;
  return (
    <>
      <Group title={t("settings.call.screen")}>
        <Row label={t("settings.call.layout")}>
          <PopupButton options={LAYOUT} value={call.layout} label={t("settings.call.layout")} onAction={(v) => void saveSection(bridge, "call_screen", { layout: v as typeof call.layout })} />
        </Row>
        <Row label={t("settings.call.auto_open")} note={t("settings.call.auto_open_note")}>
          <Toggle on={call.open_automatically} size="small" ariaLabel={t("settings.call.auto_open")} onAction={(open_automatically) => void saveSection(bridge, "call_screen", { open_automatically })} />
        </Row>
      </Group>
      <Group title={t("settings.call.menu_bar")}>
        <Row label={t("settings.call.menu_title")} note={t("settings.call.menu_title_note")}>
          <PopupButton options={TITLE} value={bar.title} label={t("settings.call.menu_title")} onAction={(v) => void saveSection(bridge, "menu_bar", { title: v as typeof bar.title })} />
        </Row>
        <Row label={t("settings.call.quick_actions")}>
          <div className="st-checks">
            {QUICK.map(({ action: a, label }) => (
              <Checkbox key={a} label={label} checked={!bar.hidden_actions.includes(a)} onAction={(on) => void saveSection(bridge, "menu_bar", { hidden_actions: on ? bar.hidden_actions.filter((x) => x !== a) : [...bar.hidden_actions, a] })} />
            ))}
          </div>
        </Row>
      </Group>
    </>
  );
}
