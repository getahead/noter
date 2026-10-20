import { useState } from "react";

import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PopupButton } from "../../ui/primitives/popup-button";
import { saveSection, useRowError } from "./actions";
import { PermissionCheckRow } from "../../ui/setup/permission-check-row";
import { PushButton } from "../../ui/primitives/push-button";
import { Group, Row } from "./form";
import { rowState } from "./permissions";
import { SelfTestSheet } from "./SelfTestSheet";
import { GlossaryGroup } from "./GlossaryGroup";
import { ModelsGroup } from "./ModelsGroup";
import { choices, type PaneProps } from "./pane-props";

const BACKENDS = choices({
  whisper_turbo_noter_loop: "settings.audio.backend_turbo",
  parakeet_tdt_v3: "settings.audio.backend_parakeet",
  whisper_pro_streaming: "settings.audio.backend_pro",
  whisper_large_v3: "settings.audio.backend_large",
});

// @cpt-dod:cpt-noter-dod-ui-settings-window:p1
export function AudioPane({ bridge, settings }: PaneProps) {
  const { audio } = settings;
  const device = useWindow(bridge, (s) => s.whole.environment?.output_device);
  const permissions = useWindow(bridge, (s) => s.whole.setup?.permissions);
  const [selfTest, setSelfTest] = useState(false);
  const audioError = useRowError(bridge, "audio");
  const headphones = device ? audio.output.headphones_devices.includes(device.uid) : false;
  const save = (edits: Partial<typeof audio>) => void saveSection(bridge, "audio", edits);
  return (
    <>
      <Group title={t("settings.audio.input_output")}>
        {device && (
          <Row label={t("settings.audio.output")} error={audioError} note={t("settings.audio.headphones_note")}>
            <Checkbox
              label={t("settings.audio.headphones", { device: device.name })}
              checked={headphones}
              onAction={(on) => save({ output: { headphones_devices: on ? [...audio.output.headphones_devices, device.uid] : audio.output.headphones_devices.filter((u) => u !== device.uid) } })}
            />
          </Row>
        )}
        <Row note={t("settings.audio.exclude_note")} error={audioError}>
          <Checkbox label={t("settings.audio.exclude")} checked={audio.exclude_own_sounds} onAction={(exclude_own_sounds) => save({ exclude_own_sounds })} />
        </Row>
      </Group>
      <Group title={t("settings.audio.transcription")}>
        <Row label={t("settings.audio.live")} error={audioError} note={t("settings.audio.live_note")}>
          <PopupButton options={BACKENDS} value={audio.live_backend} label={t("settings.audio.live")} onAction={(v) => save({ live_backend: v as typeof audio.live_backend })} />
        </Row>
        <Row label={t("settings.audio.archive")} error={audioError}>
          <PopupButton options={BACKENDS} value={audio.offline_backend} label={t("settings.audio.archive")} onAction={(v) => save({ offline_backend: v as typeof audio.offline_backend })} />
        </Row>
      </Group>
      <GlossaryGroup bridge={bridge} />
      <Group title={t("settings.audio.permissions")}>
        <PermissionCheckRow id="mic" variant="status" label={t("permission.mic")} state={rowState("microphone", permissions)} onAllow={() => void bridge.act("permission:microphone", "permission_request", () => bridge.core.permissionRequest({ kind: "microphone" }))} onOpenSettings={() => void bridge.core.openExternal({ target: { type: "system_settings", permission: "microphone" } })} />
        <PermissionCheckRow id="sys" variant="status" label={t("permission.sys")} state={rowState("system_audio", permissions)} onOpenSettings={() => void bridge.core.openExternal({ target: { type: "system_settings", permission: "system_audio" } })} />
        <Row label={t("settings.audio.self_test")} note={t("settings.audio.self_test_note")}>
          {/* @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-selftest */}
          <PushButton label={t("settings.general.run_self_test")} onAction={() => setSelfTest(true)} />
          {/* @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-selftest */}
        </Row>
      </Group>
      <ModelsGroup bridge={bridge} />
      {selfTest && <SelfTestSheet bridge={bridge} onClose={() => setSelfTest(false)} />}
    </>
  );
}
