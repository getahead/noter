import { useState } from "react";

import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { saveSection } from "./actions";
import { Group, Row } from "./form";
import { choices, type PaneProps } from "./pane-props";

const CHANNEL = choices({ stable: "settings.updates.channel_stable", beta: "settings.updates.channel_beta" });
const INSTALL = [
  { value: "auto", label: t("settings.updates.install_auto") },
  { value: "ask", label: t("settings.updates.install_ask") },
];

export function UpdatesPane({ bridge, settings }: PaneProps) {
  const u = settings.updates;
  const version = useWindow(bridge, (s) => s.app?.app_version);
  const update = useWindow(bridge, (s) => s.whole.environment?.update);
  const [checked, setChecked] = useState(false);
  const ready = update?.ready ? update : null;
  return (
    <>
      {ready && (
        <InlineBanner
          banner={{
            id: "update-ready",
            severity: "info",
            dismissible: false,
            text: t("settings.updates.ready", { version: ready.version }),
            // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-update
            actions: [{ label: t("settings.updates.restart"), onAction: () => void bridge.act("update:install", "update_install", () => bridge.core.updateInstall({})) }],
            // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-update
          }}
        />
      )}
      <Group>
        <Row label={t("settings.updates.version")}>
          <span className="np-tnum">{t("settings.updates.version_value", { version: version ?? "" })}</span>
        </Row>
        <Row label={t("settings.updates.channel")}>
          <PopupButton options={CHANNEL} value={u.channel} label={t("settings.updates.channel")} onAction={(v) => void saveSection(bridge, "updates", { channel: v as typeof u.channel })} />
        </Row>
        <Row label={t("settings.updates.install")}>
          <RadioGroup name="st-install" label={t("settings.updates.install")} options={INSTALL} value={u.install_automatically ? "auto" : "ask"} onAction={(v) => void saveSection(bridge, "updates", { install_automatically: v === "auto" })} />
        </Row>
        <Row>
          <PushButton label={t("settings.updates.check")} onAction={() => setChecked(true)} />
          {checked && !ready && <InlineStatus text={t("settings.updates.up_to_date")} variant="trailing" onExpire={() => setChecked(false)} />}
        </Row>
      </Group>
    </>
  );
}
