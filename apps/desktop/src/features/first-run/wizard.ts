// The first-run wizard's controller: one per first-run window, over its bridge. It keeps the wizard's own
// state (the step shown, the self-test panel, the choices not saved yet), sends every command and reacts to
// what the core reports (docs/features/ui/first-run.md § 2). Rendering lives in first-run.tsx and ui/setup/*.
import { createStore } from "zustand/vanilla";

import type { Bridge } from "../../app/bridge/bridge";
import type { AudioRetention, DisplayId, ModelBundle, PermissionKind, PermissionState, PrivacyMode, SelfTestMsg, SetupStatus, SetupStep, StepRow, StepState } from "../../core/bindings";
import { t } from "../../i18n/format";
import { initialPermissionRow, type PermissionRowState } from "./permission-row";
import { applySelfTestEvent, initialSelfTestPanel, newAnnouncements, runSelfTest, selfTestNext, type SelfTestPanel } from "./self-test";
import { nextStep, STEP_ORDER, type WizardAction, type WizardStep } from "./steps";

/** The step where setup stopped: the first one still to do, or Assistants when every step has an answer. */
export function resumeStep(steps: readonly StepRow[]): SetupStep {
  return steps.find((s) => s.state === "todo")?.step ?? STEP_ORDER.at(-1)!;
}

export const speechBundle = (bundles: readonly ModelBundle[]) => bundles.find((b) => b.required_for_capture);
export const speechReady = (bundles: readonly ModelBundle[]) => speechBundle(bundles)?.state === "ready";
export const allReady = (bundles: readonly ModelBundle[]) => bundles.length > 0 && bundles.every((b) => b.state === "ready");
const percent = (done: number, size: number) => (size > 0 ? Math.min(100, Math.round((done / size) * 100)) : 0);
export const bundlePercent = (b: ModelBundle) => (b.state === "ready" ? 100 : percent(b.done_mb, b.size_mb));
/** The speech model's progress, for "Waiting for the speech model · N %". */
export const speechPercent = (bundles: readonly ModelBundle[]) => {
  const b = speechBundle(bundles);
  return b ? bundlePercent(b) : 0;
};
/** The whole download's progress, for the stepper's background ring. */
export const overallPercent = (models: SetupStatus["models"]) => (allReady(models.bundles) ? 100 : percent(models.done_mb, models.total_mb));

export type BundleRowState = "failed" | "finished" | "paused" | "running";
export function bundleRowState(b: ModelBundle): BundleRowState {
  if (b.state === "checksum_failed" || b.state === "failed") return "failed";
  if (b.state === "ready") return "finished";
  return b.state === "paused" ? "paused" : "running";
}

/** Resume is offered once every unfinished bundle is paused, Pause while one downloads. */
export const downloadPaused = (bundles: readonly ModelBundle[]) => {
  const open = bundles.filter((b) => b.state !== "ready");
  return open.length > 0 && open.every((b) => b.state === "paused");
};

/** 2100 MB as 2.1 GB: one decimal, in the number format of the locale. */
export const gigabytes = (mb: number) => t("first_run.models.size", { size: Math.round(mb / 100) / 10 });
/** The whole download as "2 GB", for "About 2 GB". */
export const wholeGigabytes = (mb: number) => t("first_run.models.size", { size: Math.max(1, Math.round(mb / 1000)) });

/** What the panel shows for the permission and the speech model, after the user or the core changed either. */
export function syncSelfTest(panel: SelfTestPanel, env: { sysGranted: boolean; modelReady: boolean }): { panel: SelfTestPanel; autoRun: boolean } {
  let state = selfTestNext(panel.state, { type: "system_audio", state: env.sysGranted ? "granted" : "not_asked" });
  // the wizard waits at once when the speech model is not in (prototype `speech-wait`), not only after Run Test
  if (state === "IDLE" && !env.modelReady) state = selfTestNext(state, { type: "run", modelReady: false });
  const arrived = state === "WAITING_FOR_MODEL" && env.modelReady;
  if (arrived) state = selfTestNext(state, { type: "model_arrived" });
  if (state === panel.state) return { panel, autoRun: false };
  return { panel: { ...initialSelfTestPanel(state, panel.excludeOwnSounds), failure: panel.failure }, autoRun: arrived };
}

export interface WizardState {
  current: WizardStep;
  /** True when the window opened where setup had stopped. */
  resumed: boolean;
  panel: SelfTestPanel;
  /** The user pressed Play Test Clip for the running test. */
  clip: boolean;
  /** Permissions the user sent to System Settings and has not come back from yet. */
  away: PermissionKind[];
  /** Permissions the core is re-reading after the user came back. */
  checking: PermissionKind[];
  /** The self-test heard only digital silence on the system channel: System Audio Recording is not allowed. */
  zeroBuffers: boolean;
  /** The core's last refusal of a download for lack of disk space. */
  disk: { needed_mb: number; free_mb: number } | null;
  /** The stored settings have been read: until then Continue saves nothing from the defaults below. */
  loaded: boolean;
  display: DisplayId | null;
  autoOpen: boolean;
  retention: AudioRetention;
  privacy: PrivacyMode;
  modelsAnnounced: boolean;
}

export type Wizard = ReturnType<typeof createWizard>;

const DONE: StepState = "done";

export function createWizard(bridge: Bridge, announce: (text: string, key: string) => void) {
  const win = () => bridge.store.getState();
  const setup = () => win().whole.setup!;
  const sysGranted = (s: WizardState, status: SetupStatus) => !s.zeroBuffers && status.permissions.find((p) => p.kind === "system_audio")?.state === "granted";
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-status
  const status0 = setup(); // the window's snapshot carries the setup status, kept current by `setup:changed`
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-status
  const current = resumeStep(status0.steps);
  const store = createStore<WizardState>(() => ({
    current,
    resumed: current !== STEP_ORDER[0],
    panel: initialSelfTestPanel("IDLE", true),
    clip: false,
    away: [],
    checking: [],
    zeroBuffers: false,
    disk: null,
    loaded: false,
    display: status0.call_display,
    autoOpen: true,
    retention: "days30",
    privacy: "cloud_redacted",
    modelsAnnounced: allReady(status0.models.bundles),
  }));
  const set = store.setState;
  let rev = 0;
  let consumed = { id: "", count: 0 };
  let started = false;
  let requested = false;
  /** What the user changed before the stored settings arrived: those keep the user's value. */
  const edited = new Set<string>();
  let generation = 0;
  /** The privacy mode the core last confirmed (read or saved): the radio goes back to it when a change is refused. */
  let confirmedPrivacy: PrivacyMode = "cloud_redacted";
  let saving: Promise<unknown> = Promise.resolve();
  /** What Try Again runs: the user's last action that the core refused. */
  let lastAction: () => Promise<void> = async () => {};

  /** A command of the wizard; the setup status it returns replaces the window's. */
  const send = bridge.act;

  function refreshSelfTest(): void {
    const status = setup();
    const s = store.getState();
    const { panel, autoRun } = syncSelfTest(s.panel, { sysGranted: sysGranted(s, status), modelReady: speechReady(status.models.bundles) });
    if (panel !== s.panel) set({ panel });
    if (autoRun) void subscribeRun(false);
  }

  // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-announce-done
  function refreshModels(): void {
    const s = store.getState();
    if (s.modelsAnnounced || !allReady(setup().models.bundles)) return;
    set({ modelsAnnounced: true });
    announce(t("first_run.models.done"), "downloads_done");
  }
  // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-announce-done

  /** Fold the Channel messages that arrived since the last look into the panel, and say the new result lines. */
  function consumeMessages(): void {
    const data = win().streams.self_test_run?.data;
    if (!data) return;
    if (consumed.id !== data.subscription_id) consumed = { id: data.subscription_id, count: 0 };
    const fresh: SelfTestMsg[] = data.messages.slice(consumed.count);
    if (fresh.length === 0) return;
    consumed.count = data.messages.length;
    let panel = store.getState().panel;
    for (const m of fresh) {
      // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-render-selftest
      const next = applySelfTestEvent(panel, m.event);
      // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-render-selftest
      // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-if-passed
      // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-passed
      newAnnouncements(panel, next).forEach((text, i) => announce(text, `self_test:${data.subscription_id}:${m.seq}:${i}`));
      // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-passed
      // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-if-passed
      panel = next;
      if (m.event.type === "failed" && m.event.reason.type === "zero_buffers") set({ zeroBuffers: true });
    }
    // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-return-selftest
    set({ panel });
    // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-return-selftest
  }

  const onWindowChange = () => {
    if (!win().whole.setup) return; // the window closed and its store was emptied
    consumeMessages();
    refreshSelfTest();
    refreshModels();
  };

  async function settingsNow() {
    // through `act`, so a refusal is a named state the screen shows (with Try Again only when it can work)
    const res = await send("settings_get", "settings_get", () => bridge.core.settingsGet({}));
    if (res.status !== "ok") return null;
    rev = res.data.rev;
    return res.data;
  }

  async function loadSettings(): Promise<void> {
    const mine = generation;
    const s = await settingsNow();
    if (!s || mine !== generation) return; // refused, or the window's wizard was stopped meanwhile
    confirmedPrivacy = s.privacy.mode;
    const stored = { autoOpen: s.call_screen.open_automatically, retention: s.audio.retention, privacy: s.privacy.mode };
    set((w) => ({
      loaded: true,
      ...Object.fromEntries(Object.entries(stored).filter(([k]) => !edited.has(k))),
      panel: { ...w.panel, excludeOwnSounds: s.audio.exclude_own_sounds },
    }));
  }

  async function download(action: "start" | "pause" | "resume" | "retry"): Promise<void> {
    // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-api-download
    if (action !== "pause") set({ disk: null });
    const res = await send("models_download", "models_download", () => bridge.core.modelsDownload({ action }), { slice: "setup" });
    // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-api-download
    // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-disk
    if (res.status === "error" && res.error.code === "disk_full" && res.error.detail?.type === "disk_space") {
      const { free_mb, needed_mb } = res.error.detail;
      set({ disk: { free_mb, needed_mb } });
    }
    // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-case-disk
  }

  async function saveStep(step: SetupStep, state: StepState): Promise<boolean> {
    const res = await send("setup_set_step", "setup_set_step", () => bridge.core.setupSetStep({ step, state }), { slice: "setup" });
    return res.status === "ok";
  }

  async function saveSettings(section: Parameters<typeof bridge.core.settingsUpdate>[0]["section"]): Promise<boolean> {
    const res = await send("settings_update", "settings_update", () => bridge.core.settingsUpdate({ rev, section }));
    if (res.status === "ok") rev = res.data.rev;
    return res.status === "ok";
  }

  /** What the step's Continue saves before the wizard moves on. */
  async function saveChoices(step: SetupStep): Promise<boolean> {
    if (step === "call_display" || step === "audio_storage") {
      // the settings failed to load: saving the defaults would overwrite what is stored
      if (!store.getState().loaded) await loadSettings();
      if (!store.getState().loaded) return false;
    }
    const s = store.getState();
    if (step === "call_display") {
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-call-display
      const res = await send("setup_set_call_display", "setup_set_call_display", () => bridge.core.setupSetCallDisplay({ display_id: s.display }), { slice: "setup" });
      const now = await settingsNow();
      if (res.status !== "ok" || !now) return false;
      return saveSettings({ section: "call_screen", value: { ...now.call_screen, open_automatically: s.autoOpen } });
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-call-display
    }
    if (step === "audio_storage") {
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-audio-storage
      const args = { never_store_audio: s.retention === "never_store", retention: s.retention };
      const res = await send("setup_set_audio_storage", "setup_set_audio_storage", () => bridge.core.setupSetAudioStorage(args), { slice: "setup" });
      return res.status === "ok";
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-audio-storage
    }
    return true;
  }

  async function leave(action: Extract<WizardAction, { type: "continue" | "skip" }>): Promise<void> {
    const step = store.getState().current;
    if (step === "done") return;
    // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-welcome
    // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-skip
    if (action.type === "continue" && !(await saveChoices(step))) return;
    if (!(await saveStep(step, action.type === "skip" ? "skipped" : DONE))) return;
    // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-skip
    // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-welcome
    set({ current: nextStep(step, action) });
  }

  /** Open the self-test Channel for a panel already RUNNING. */
  async function subscribeRun(playClip: boolean): Promise<void> {
    set({ clip: playClip, zeroBuffers: false });
    // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-api-selftest
    await bridge.subscribe("self_test_run", { play_clip: playClip }, { model_missing: "model_missing" });
    // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-api-selftest
    const refusal = win().streams.self_test_run?.error;
    if (!refusal) return;
    // a race with the model: the core still refuses, so wait for it; any other refusal ends the test
    const waiting = refusal.state === "model_missing";
    set((w) => ({ panel: { ...w.panel, state: waiting ? "WAITING_FOR_MODEL" : "FAILED", failure: waiting ? null : "self_test.refused", runEnabled: !waiting } }));
  }

  async function runTest(playClip: boolean): Promise<void> {
    // @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-user-test
    const s = store.getState();
    const panel = runSelfTest(s.panel, speechReady(setup().models.bundles));
    if (panel === s.panel) return;
    set({ panel });
    // @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-user-test
    // the speech model is not in: the panel waits and runs by itself when it is (D-21), without asking the core to refuse
    if (panel.state === "RUNNING") await subscribeRun(playClip);
  }

  return {
    store,
    /** Load the settings the steps show, start the downloads and follow the microphone level. Call once; returns the cleanup. */
    start(): () => void {
      if (started) return () => {};
      started = true;
      generation++;
      const unsubscribeStore = bridge.store.subscribe(onWindowChange);
      lastAction = loadSettings;
      void loadSettings();
      // @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-api-download
      if (!requested && setup().models.bundles.some((b) => b.state === "pending")) void download("start");
      requested = true; // a remount does not start them again
      // @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-api-download
      refreshSelfTest();
      // the microphone meter needs the levels stream (M1 on the real core): without it the row shows no meter
      void bridge.subscribe("levels_subscribe", { call_id: null }, { not_implemented: "unavailable" });
      return () => {
        started = false;
        generation++; // a settings read still on its way is dropped
        unsubscribeStore();
        void bridge.unsubscribe("levels_subscribe");
        void bridge.unsubscribe("self_test_run");
      };
    },
    download,
    continue: () => ((lastAction = () => leave({ type: "continue" })), lastAction()),
    skip: () => ((lastAction = () => leave({ type: "skip" })), lastAction()),
    /** Try Again on a refused save or read. */
    retry: () => lastAction(),
    back: () => set((s) => ({ current: nextStep(s.current, { type: "back" }) })),
    goto: (step: SetupStep) => set((s) => ({ current: nextStep(s.current, { type: "goto", step }) })),
    async finish(): Promise<void> {
      lastAction = () => this.finish();
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-finish
      if (!(await saveStep("assistants", DONE))) return;
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-finish
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-finish
      set({ current: nextStep("assistants", { type: "finish" }) });
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-return-finish
      await bridge.core.windowNavigate({ target: { type: "today" } }); // M1: a refusal leaves Today to the host
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-return-finish
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-finish
    },
    /** Allow… on a row that has never been asked. */
    async allow(kind: PermissionKind): Promise<void> {
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-mic
      await send("permission_request", "permission_request", () => bridge.core.permissionRequest({ kind }));
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-mic
      await send("setup_status", "setup_status", () => bridge.core.setupStatus({}), { slice: "setup" });
    },
    /** Open System Settings… beside a row; the row checks again when the user is back in Noter. */
    async openSettings(kind: PermissionKind): Promise<void> {
      set((s) => ({ away: s.away.includes(kind) ? s.away : [...s.away, kind] }));
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-open-settings
      await bridge.core.openExternal({ target: { type: "system_settings", permission: kind } });
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-api-open-settings
    },
    /** Noter is in front again: the rows the user sent to System Settings show Checking… while the core re-reads them. */
    async returned(): Promise<void> {
      const away = store.getState().away;
      if (away.length === 0) return;
      // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-checking
      set({ away: [], checking: away, zeroBuffers: false });
      try {
        // macOS reports no change of System Audio Recording: the core hears it, with a short tap, unless it already knows it is off
        const asked = setup().permissions.find((p) => p.kind === "system_audio")?.state;
        if (away.includes("system_audio") && asked !== "denied") await send("permission_request", "permission_request", () => bridge.core.permissionRequest({ kind: "system_audio" }));
        await send("setup_status", "setup_status", () => bridge.core.setupStatus({}), { slice: "setup" });
      } finally {
        set({ checking: [] });
      }
      // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-checking
      refreshSelfTest();
    },
    runTest,
    choose: (patch: Partial<Pick<WizardState, "display" | "autoOpen" | "retention">>) => {
      Object.keys(patch).forEach((k) => edited.add(k));
      set(patch);
    },
    async choosePrivacy(mode: PrivacyMode): Promise<void> {
      lastAction = () => this.choosePrivacy(mode);
      edited.add("privacy");
      set({ privacy: mode });
      // one save at a time: each reads the settings' rev, which the one before moved
      const run = saving.then(async () => {
        const now = await settingsNow();
        if (now) confirmedPrivacy = now.privacy.mode;
        // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-assistants
        const ok = now ? await saveSettings({ section: "privacy", value: { ...now.privacy, mode } }) : false;
        // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-assistants
        // the core kept the mode it had when this save started: show that, unless the user has chosen again since
        if (!ok && store.getState().privacy === mode) set({ privacy: confirmedPrivacy });
        else if (ok) confirmedPrivacy = mode;
      });
      saving = run.catch(() => {});
      await run;
    },
  };
}

/** The permission row's state for what the core reports, the wizard's own checking and the self-test's zero buffers. */
export function rowStateFor(kind: PermissionKind, core: PermissionState | undefined, s: Pick<WizardState, "checking" | "zeroBuffers">): PermissionRowState {
  if (s.checking.includes(kind) && core !== "granted") return "CHECKING";
  if (kind === "system_audio" && s.zeroBuffers) return "MISSING";
  return initialPermissionRow(kind, core ?? "not_asked");
}
