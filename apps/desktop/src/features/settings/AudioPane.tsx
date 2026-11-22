import { useEffect, useRef, useState } from "react";

import type { Lang, OutputRoute } from "../../core/bindings";
import { dbToLevel } from "../first-run/self-test";
import { LevelMeter } from "../../ui/primitives/level-meter";

import { useWindow } from "../../app/use-window";
import { applySnapshot } from "../../app/store/window-store";
import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PopupButton } from "../../ui/primitives/popup-button";
import { saveSection, useRowErrors } from "./actions";
import { NativePermissionDetails } from "../../ui/setup/native-permission-details";
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

export function registerSystemAudioReturn(bridge: Bridge, pending: { current: boolean }): () => void {
  const onFocus = async () => {
    if (!pending.current) return;
    pending.current = false;
    await bridge.act("permission:system_audio", "permission_request", () => bridge.core.permissionRequest({ kind: "system_audio" }));
    const snapshot = await bridge.core.appSnapshot({});
    if (snapshot.status === "ok") bridge.store.setState((state) => applySnapshot(state, snapshot.data));
  };
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}

// @cpt-dod:cpt-noter-dod-ui-settings-window:p1
const LANGUAGES: { lang: Lang; key: "settings.audio.lang_en" | "settings.audio.lang_ru" | "settings.audio.lang_de" }[] = [
  { lang: "en", key: "settings.audio.lang_en" },
  { lang: "ru", key: "settings.audio.lang_ru" },
  { lang: "de", key: "settings.audio.lang_de" },
];
const ROUTE: Record<OutputRoute, "settings.audio.route_headphones" | "settings.audio.route_speakers" | "settings.audio.route_unknown"> = {
  headphones: "settings.audio.route_headphones",
  speakers: "settings.audio.route_speakers",
  unknown: "settings.audio.route_unknown",
};

/** Microphone (DESIGN 3.2): the inputs the core reports, the system default first, with the live input level. */
export function MicrophoneRow({ bridge, value, error, onChange }: { bridge: Bridge; value: string | null; error: string | null; onChange: (uid: string | null) => void }) {
  const inputs = useWindow(bridge, (s) => s.whole.environment?.input_devices) ?? [];
  const micDb = useWindow(bridge, (s) => s.streams.levels_subscribe?.data?.levels?.mic_db);
  // the meter listens while the pane is open, as first run's does
  useEffect(() => {
    void bridge.subscribe("levels_subscribe", { call_id: null }, { not_implemented: "unavailable" });
    return () => void bridge.unsubscribe("levels_subscribe");
  }, [bridge]);
  const fallback = inputs.find((d) => d.is_default)?.name ?? "";
  const options = [{ value: "", label: t("settings.audio.mic_default", { device: fallback }) }, ...inputs.map((d) => ({ value: d.uid, label: d.name }))];
  return (
    <Row label={t("settings.audio.microphone")} error={error}>
      <span className="st-mic">
        <PopupButton options={options} value={value ?? ""} label={t("settings.audio.microphone")} onAction={(v) => onChange(v || null)} />
        <LevelMeter level={dbToLevel(micDb ?? null)} label={t("settings.audio.mic_level")} />
      </span>
    </Row>
  );
}

export function AudioPane({ bridge, settings }: PaneProps) {
  const { audio } = settings;
  const outputs = useWindow(bridge, (s) => s.whole.environment?.output_devices) ?? [];
  const native = useWindow(bridge, (s) => s.whole.environment?.native);
  const permissions = useWindow(bridge, (s) => s.whole.setup?.permissions);
  const [selfTest, setSelfTest] = useState(false);
  const recheckPermission = useRef(false);
  useEffect(() => registerSystemAudioReturn(bridge, recheckPermission), [bridge]);
  const rowError = useRowErrors(bridge);
  const save = (edits: Partial<typeof audio>) => void saveSection(bridge, "audio", edits);
  return (
    <>
      <Group title={t("settings.audio.input_output")}>
        <MicrophoneRow bridge={bridge} value={audio.mic_device ?? null} error={rowError("audio", "mic_device")} onChange={(mic_device) => save({ mic_device })} />
        {outputs.length > 0 && (
          <Row label={t("settings.audio.outputs")} stack error={rowError("audio", "output.headphones_devices")} note={t("settings.audio.outputs_note")}>
            <ul className="st-devices" role="group" aria-label={t("settings.audio.outputs")}>
              {outputs.map((d) => {
                // a device the user marked is still one Noter could not identify: it keeps "Not identified" with the box ticked (PM-65)
                const unidentified = d.route === "unknown" || d.marked_headphones;
                return (
                <li key={d.uid} className="st-device">
                  <span className="st-device__name">{d.name}</span>
                  <span className="np-dim">{t(ROUTE[unidentified ? "unknown" : d.route])}</span>
                  {unidentified && (
                    <Checkbox
                      label={t("settings.audio.treat_headphones")}
                      checked={d.marked_headphones}
                      onAction={(on) => void saveSection(bridge, "audio", (current) => ({ output: { headphones_devices: on ? [...current.output.headphones_devices, d.uid] : current.output.headphones_devices.filter((u) => u !== d.uid) } }))}
                    />
                  )}
                </li>
                );
              })}
            </ul>
          </Row>
        )}
        <Row note={t("settings.audio.exclude_note")} error={rowError("audio", "exclude_own_sounds")}>
          <Checkbox label={t("settings.audio.exclude")} checked={audio.exclude_own_sounds} onAction={(exclude_own_sounds) => save({ exclude_own_sounds })} />
        </Row>
      </Group>
      <Group title={t("settings.audio.transcription")}>
        <Row label={t("settings.audio.live")} error={rowError("audio", "live_backend")} note={t("settings.audio.live_note")}>
          <PopupButton options={BACKENDS} value={audio.live_backend} label={t("settings.audio.live")} onAction={(v) => save({ live_backend: v as typeof audio.live_backend })} />
        </Row>
        <Row label={t("settings.audio.archive")} error={rowError("audio", "offline_backend")}>
          <PopupButton options={BACKENDS} value={audio.offline_backend} label={t("settings.audio.archive")} onAction={(v) => save({ offline_backend: v as typeof audio.offline_backend })} />
        </Row>
        <Row label={t("settings.audio.languages")} error={rowError("audio", "languages")} note={t("settings.audio.languages_note")}>
          <div className="st-checks" role="group" aria-label={t("settings.audio.languages")}>
            {LANGUAGES.map(({ lang, key }) => (
              <Checkbox
                key={key}
                label={t(key)}
                checked={(audio.languages ?? []).includes(lang)}
                onAction={(on) => void saveSection(bridge, "audio", (current) => ({ languages: LANGUAGES.map((l) => l.lang).filter((l) => (l === lang ? on : (current.languages ?? []).includes(l))) }))}
              />
            ))}
          </div>
        </Row>
      </Group>
      <GlossaryGroup bridge={bridge} />
      <Group title={t("settings.audio.permissions")}>
        <PermissionCheckRow id="mic" variant="status" label={t("permission.mic")} state={rowState("microphone", permissions)} onAllow={() => void bridge.act("permission:microphone", "permission_request", () => bridge.core.permissionRequest({ kind: "microphone" }))} onOpenSettings={() => void bridge.core.openExternal({ target: { type: "system_settings", permission: "microphone" } })} />
        <PermissionCheckRow id="sys" variant="status" label={t("permission.sys")} state={rowState("system_audio", permissions)} onOpenSettings={() => { recheckPermission.current = true; void bridge.core.openExternal({ target: { type: "system_settings", permission: "system_audio" } }); }} />
        <NativePermissionDetails native={native} />
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
