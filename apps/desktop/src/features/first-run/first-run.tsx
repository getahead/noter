// The first-run window (docs/features/ui/first-run.md, DESIGN › Screen — First-run wizard): FR-R1 the stepper,
// FR-R2 the step, FR-R3 the footer. The wizard controller (wizard.ts) holds the state and sends the commands.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";

import { useAnnounce } from "../../app/a11y/announce";
import type { Bridge } from "../../app/bridge/bridge";
import type { AudioRetention, PermissionKind, PrivacyMode, SetupStatus } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { Msg } from "../../i18n/Msg";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { Progress } from "../../ui/primitives/progress";
import { PushButton } from "../../ui/primitives/push-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { Toggle } from "../../ui/primitives/toggle";
import { DisplayPicker } from "../../ui/setup/display-picker";
import { PermissionCheckRow } from "../../ui/setup/permission-check-row";
import { SelfTestPanel } from "../../ui/setup/self-test-panel";
import { STEP_AT, stepLabel, WizardStepper, type StepperEntry } from "../../ui/setup/wizard-stepper";
import { AUTO_DISPLAY, defaultDisplay } from "./default-display";
import { dbToLevel, hearing } from "./self-test";
import { STEP_ORDER, stepperItems, type StepperItemState } from "./steps";
import { bundlePercent, bundleRowState, createWizard, downloadPaused, gigabytes, overallPercent, rowStateFor, speechPercent, wholeGigabytes, type Wizard, type WizardState } from "./wizard";
import "../../ui/setup/setup.css";

/** Read a value of a vanilla store and re-render when it changes. */
function useSelect<S, T>(store: Pick<StoreApi<S>, "getState" | "subscribe">, pick: (s: S) => T): T {
  const get = () => pick(store.getState());
  return useSyncExternalStore(store.subscribe, get, get);
}

const ITEM_STATE: Record<StepperItemState, StepperEntry["state"]> = { UPCOMING: "upcoming", CURRENT: "current", DONE: "done", SKIPPED: "skipped", ERROR: "error", RUNNING_IN_BACKGROUND: "running" };
const SAVES = ["setup_set_step", "setup_set_call_display", "setup_set_audio_storage", "settings_update", "settings_get"];
const SKIPPABLE = ["permissions", "call_display"];
const permissionState = (status: SetupStatus, kind: PermissionKind) => status.permissions.find((p) => p.kind === kind)?.state;

function Title({ id }: { id: MsgKey }) {
  return (
    <h1 className="fr-title" tabIndex={-1}>
      <Msg id={id} />
    </h1>
  );
}

function Welcome() {
  return (
    <>
      <h1 className="fr-title t-large" tabIndex={-1}>
        <Msg id="first_run.welcome.title" />
      </h1>
      <p className="fr-p">
        <Msg id="first_run.welcome.body" />
      </p>
      <ul className="fr-list">
        <li>
          <Icon name="globe" size={15} />
          <Msg id="first_run.welcome.languages" />
        </li>
        <li>
          <Icon name="laptop" size={15} />
          <Msg id="first_run.welcome.private" />
        </li>
        <li>
          <Icon name="mic" size={15} />
          <Msg id="first_run.welcome.permissions" />
        </li>
      </ul>
    </>
  );
}

function Models({ bridge, wizard, w }: { bridge: Bridge; wizard: Wizard; w: WizardState }) {
  const status = useSelect(bridge.store, (s) => s.whole.setup!);
  const env = useSelect(bridge.store, (s) => s.whole.environment);
  const { bundles, total_mb, done_mb, error } = status.models;
  const paused = downloadPaused(bundles);
  // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-match-download
  // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-disk
  const disk = w.disk ?? (error === "disk_full" ? { needed_mb: total_mb - done_mb, free_mb: env?.disk_free_mb ?? 0 } : null);
  // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-disk
  // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-match-download
  // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-return-models
  return (
    <>
      <Title id="first_run.models.title" />
      <p className="fr-p">
        <Msg id="first_run.models.body" />
      </p>
      {disk && <InlineBanner banner={{ id: "disk", severity: "error", text: t("first_run.models.disk", { needed: gigabytes(disk.needed_mb), free: gigabytes(disk.free_mb) }), actions: [{ label: t("action.try_again"), onAction: () => void wizard.download("start") }] }} />}
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-offline */}
      {env && !env.online && (
        <div className="fr-waitline">
          <Icon name="clock" size={13} />
          <Msg id="first_run.models.offline" />
        </div>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-offline */}
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-list-bundles */}
      <div className="fr-models np-card">
        {bundles.map((b) => {
          const state = bundleRowState(b);
          const pct = bundlePercent(b);
          return (
            <div key={b.name} className="fr-model" data-state={state}>
              <div className="fr-model__name">
                {b.name}
                <span className="np-dim"> · {gigabytes(b.size_mb)}</span>
              </div>
              <div className="fr-model__bar">
                <Progress value={pct} state={state} label={b.name} />
                <span className="np-tnum fr-model__pct">
                  {state === "finished" ? <Msg id="first_run.models.ready" /> : state === "failed" ? <Msg id="first_run.models.check_failed" /> : <Msg id="first_run.models.percent" args={{ value: pct }} />}
                </span>
                {/* @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-checksum */}
                {state === "failed" && <PushButton label={t("action.try_again")} size="small" onAction={() => void wizard.download("retry")} />}
                {/* @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-checksum */}
              </div>
            </div>
          );
        })}
        <div className="fr-models__foot">
          <span>
            <Msg id="first_run.models.about" args={{ size: wholeGigabytes(total_mb) }} />
          </span>
          <span className="np-tb__spacer" />
          {/* @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-progress */}
          {!disk && <PushButton label={paused ? t("first_run.models.resume") : t("first_run.models.pause")} size="small" onAction={() => void wizard.download(paused ? "resume" : "pause")} />}
          {/* @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-progress */}
        </div>
      </div>
      {/* @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-list-bundles */}
    </>
  );
  // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-return-models
}

function Permissions({ bridge, wizard, w }: { bridge: Bridge; wizard: Wizard; w: WizardState }) {
  const status = useSelect(bridge.store, (s) => s.whole.setup!);
  const micDb = useSelect(bridge.store, (s) => s.streams.levels_subscribe?.data?.levels?.mic_db);
  const mic = rowStateFor("microphone", permissionState(status, "microphone"), w);
  return (
    <>
      <Title id="first_run.permissions.title" />
      <p className="fr-p">
        <Msg id="first_run.permissions.body" />
      </p>
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-permissions-step */}
      <div className="fr-perms">
        <PermissionCheckRow
          id="mic"
          label={t("permission.mic")}
          state={mic}
          why={t("permission.mic_why")}
          // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-mic-allowed
          // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-mic-meter
          hearing={mic === "GRANTED" && hearing(micDb) ? { level: dbToLevel(micDb ?? null) } : undefined}
          // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-mic-meter
          // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-mic-allowed
          onAllow={() => void wizard.allow("microphone")}
          onOpenSettings={() => void wizard.openSettings("microphone")}
        />
        <PermissionCheckRow
          id="sys"
          label={t("permission.sys")}
          state={rowStateFor("system_audio", permissionState(status, "system_audio"), w)}
          why={t("permission.sys_why")}
          howto={t("permission.sys_howto")}
          onOpenSettings={() => void wizard.openSettings("system_audio")}
        />
      </div>
      {/* @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-permissions-step */}
      <SelfTestPanel panel={w.panel} waitingPercent={speechPercent(status.models.bundles)} playClip={w.clip} onPlayClip={() => void wizard.runTest(true)} onRun={() => void wizard.runTest(false)} onOpenSettings={() => void wizard.openSettings("system_audio")} />
    </>
  );
}

function CallDisplay({ bridge, wizard, w }: { bridge: Bridge; wizard: Wizard; w: WizardState }) {
  const displays = useSelect(bridge.store, (s) => s.whole.environment?.displays) ?? [];
  const picker = defaultDisplay(displays, w.display);
  return (
    <>
      <Title id="first_run.display.title" />
      <p className="fr-p">
        <Msg id="first_run.display.body" />
      </p>
      <DisplayPicker picker={picker} displays={displays} onSelect={(v) => wizard.choose({ display: v === AUTO_DISPLAY ? null : v })} />
      <div className="fr-row">
        <Toggle id="fr-autoopen" label={t("first_run.display.auto_open")} on={w.autoOpen} onAction={(autoOpen) => wizard.choose({ autoOpen })} />
      </div>
      <p className="fr-hint">
        <Msg id="first_run.display.auto_open_hint" />
      </p>
    </>
  );
}

function AudioStorage({ wizard, w }: { wizard: Wizard; w: WizardState }) {
  return (
    <>
      <Title id="first_run.storage.title" />
      <p className="fr-p">
        <Msg id="first_run.storage.body" />
      </p>
      <RadioGroup
        name="fr-retention"
        label={t("first_run.storage.label")}
        value={w.retention}
        options={[
          { value: "days30", label: t("first_run.storage.days30"), note: t("first_run.storage.days30_note") },
          { value: "days7", label: t("first_run.storage.days7") },
          { value: "days90", label: t("first_run.storage.days90") },
          { value: "forever", label: t("first_run.storage.forever") },
          { value: "never_store", label: t("first_run.storage.never"), note: t("first_run.storage.never_note") },
        ]}
        onAction={(v) => wizard.choose({ retention: v as AudioRetention })}
      />
      <p className="fr-hint">
        <Msg id="first_run.storage.hint" />
      </p>
    </>
  );
}

// Step 6's key fields and own-account rows belong to cpt-noter-feature-ui-accounts (M2, M3): this is its frame.
function Assistants({ bridge, wizard, w }: { bridge: Bridge; wizard: Wizard; w: WizardState }) {
  const accounts = useSelect(bridge.store, (s) => s.whole.accounts);
  const local = accounts?.local.running ?? false;
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-no-assistant
  const none = !local && !accounts?.keys.some((k) => k.status.type === "configured") && !accounts?.accounts.some((a) => a.status.type === "signed_in");
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-no-assistant
  return (
    <>
      <Title id="first_run.assistants.title" />
      <p className="fr-p">
        <Msg id="first_run.assistants.body" />
      </p>
      <div className="fr-runtime">
        <span>
          <strong>
            <Msg id="first_run.assistants.runtime" />:
          </strong>{" "}
          <Msg id={local ? "first_run.assistants.runtime_found" : "first_run.assistants.runtime_none"} />
        </span>
      </div>
      <div className="fr-privacy">
        <div className="fr-sublabel">
          <Msg id="first_run.assistants.privacy" />
        </div>
        <RadioGroup
          name="fr-privacy"
          label={t("first_run.assistants.privacy")}
          value={w.privacy}
          options={[
            { value: "cloud_redacted", label: t("first_run.assistants.privacy_redacted"), note: t("first_run.assistants.privacy_redacted_note") },
            { value: "cloud_allowed", label: t("first_run.assistants.privacy_cloud") },
            { value: "local_only", label: t("first_run.assistants.privacy_local"), note: t("first_run.assistants.privacy_local_note") },
          ]}
          onAction={(v) => void wizard.choosePrivacy(v as PrivacyMode)}
        />
      </div>
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-no-assistant */}
      {none && <InlineBanner banner={{ id: "no-assistant", severity: "warning", text: t("first_run.assistants.none") }} />}
      {/* @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-no-assistant */}
    </>
  );
}

// @cpt-component:cpt-noter-component-screen-first-run:p1
// @cpt-dod:cpt-noter-dod-ui-first-run-window:p1
// @cpt-dod:cpt-noter-dod-ui-first-run-models:p1
export function FirstRun({ bridge }: { bridge: Bridge }) {
  // the store is emptied when the window closes: draw nothing until the core's status is there
  const ready = useSelect(bridge.store, (s) => !!s.whole.setup);
  return ready ? <FirstRunWindow bridge={bridge} /> : null;
}

function FirstRunWindow({ bridge }: { bridge: Bridge }) {
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open
  const announce = useAnnounce(bridge);
  const [wizard] = useState(() => createWizard(bridge, (text, key) => void announce({ kind: key === "downloads_done" ? "downloads_done" : "self_test", text, key })));
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open
  const w = useSelect(wizard.store, (s) => s);
  const status = useSelect(bridge.store, (s) => s.whole.setup!);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => wizard.start(), [wizard]);
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-checking
  useEffect(() => {
    const back = () => void wizard.returned();
    addEventListener("focus", back);
    return () => removeEventListener("focus", back);
  }, [wizard]);
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-checking
  const shown = useRef(w.current);
  useEffect(() => {
    if (shown.current === w.current) return;
    shown.current = w.current;
    body.current?.querySelector<HTMLElement>("h1")?.focus(); // a step change moves focus to its heading
  }, [w.current]);
  // a refused save keeps the step: say so, with Try Again
  const refused = useSelect(bridge.store, (s) => SAVES.find((k) => s.commands[k]?.state === "ERROR"));
  // a refusal that cannot succeed on a second try gets no Try Again
  const canRetry = useSelect(bridge.store, (s) => (refused ? !!s.commands[refused]?.error?.tryAgain : false));
  const step = w.current === "done" ? "assistants" : w.current;
  const index = STEP_ORDER.indexOf(step);
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open-step
  const steps: StepperEntry[] = stepperItems(w.current, status).map((s) => ({ ...s, state: ITEM_STATE[s.state], progress: overallPercent(status.models) }));
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open-step
  return (
    <div className="fr" data-component="cpt-noter-component-screen-first-run" data-variant={STEP_AT[index]} data-state={step.replaceAll("_", "-")}>
      <aside className="fr-r1" data-region="FR-R1" aria-label={t("first_run.steps")}>
        <div className="fr-r1__lights" />
        <h2 className="fr-r1__h">
          <Msg id="first_run.title" />
        </h2>
        <WizardStepper steps={steps} variant={w.resumed ? "resumed" : "first-pass"} onGoto={wizard.goto} />
        <p className="fr-r1__note">
          <Msg id="first_run.note" />
        </p>
      </aside>
      <div className="fr-main">
        <div className="fr-r2" data-region="FR-R2" aria-label={stepLabel(step)} ref={body}>
          {refused && <InlineBanner banner={{ id: "refused", severity: "error", text: t("window.error"), actions: canRetry ? [{ label: t("action.try_again"), onAction: () => void wizard.retry() }] : [] }} />}
          {step === "welcome" && <Welcome />}
          {/* @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-models-step */}
          {step === "models" && <Models bridge={bridge} wizard={wizard} w={w} />}
          {/* @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-models-step */}
          {step === "permissions" && <Permissions bridge={bridge} wizard={wizard} w={w} />}
          {step === "call_display" && <CallDisplay bridge={bridge} wizard={wizard} w={w} />}
          {step === "audio_storage" && <AudioStorage wizard={wizard} w={w} />}
          {step === "assistants" && <Assistants bridge={bridge} wizard={wizard} w={w} />}
        </div>
        <footer className="fr-r3" data-region="FR-R3">
          <span className="fr-r3__env">
            <Msg id="first_run.env" />
          </span>
          <span className="np-tb__spacer" />
          {/* @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-skip */}
          {SKIPPABLE.includes(step) && <PushButton label={t("first_run.skip")} variant="quiet" onAction={() => void wizard.skip()} />}
          {/* @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-if-skip */}
          <PushButton label={t("first_run.back")} disabled={index === 0} onAction={wizard.back} />
          {step === "assistants" ? <PushButton label={t("first_run.finish")} variant="primary" onAction={() => void wizard.finish()} /> : <PushButton label={t("first_run.continue")} variant="primary" onAction={() => void wizard.continue()} />}
        </footer>
      </div>
    </div>
  );
}
