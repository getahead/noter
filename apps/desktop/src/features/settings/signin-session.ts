// The sign-in of one provider as a pure machine (docs/features/ui/accounts.md › cpt-noter-algo-ui-accounts-session):
// Prepare → Sign in → Check → Use, with install, existing-account reuse, errors and a sheet that can be hidden. The core
// is the authority: nothing here confirms a sign-in or binds an agent by itself, and no secret enters this state.
import type { AccountIdentity, AccountProvider, ErrorCode, SignInPrepare, SignInProgress, SignInSession } from "../../core/bindings";

export type SignInPhase = "SIGNED_OUT" | "PREPARE" | "INSTALLING" | "BROWSER" | "CHECK" | "USE" | "SIGNIN_ERROR";

export interface SignIn {
  phase: SignInPhase;
  /** Esc hid the sheet: the session lives on in the core and the row offers Show. */
  hidden: boolean;
  provider: AccountProvider | null;
  prepare: SignInPrepare | null;
  cliMissing: boolean;
  /** `cli_version_unsupported` from prepare: the tool is there but too old. */
  cliUnsupported: boolean;
  /** The last install job failed or was cancelled. */
  installFailed: boolean;
  choice: "existing" | "other";
  /** The personal-use box (Claude only). */
  confirmed: boolean;
  /** The `cli_install` job run this sheet waits for. */
  runId: string | null;
  /** Code and link live here only while the sheet needs them. */
  session: SignInSession | null;
  sessionId: string | null;
  identity: AccountIdentity | null;
  /** `done` arrived; Use waits for the accounts state to say signed in. */
  done: boolean;
  code: ErrorCode | null;
}

export const closed: SignIn = { phase: "SIGNED_OUT", hidden: false, provider: null, prepare: null, cliMissing: false, cliUnsupported: false, installFailed: false, choice: "other", confirmed: false, runId: null, session: null, sessionId: null, identity: null, done: false, code: null };

export type SignInEvent =
  | { type: "open" }
  | { type: "prepared"; prepare: SignInPrepare }
  | { type: "prepareFailed"; code: ErrorCode }
  | { type: "confirm"; on: boolean }
  | { type: "choose"; choice: "existing" | "other" }
  | { type: "installStarted"; runId: string }
  | { type: "installDone"; runId: string }
  | { type: "installFailed"; runId: string }
  | { type: "started"; session: SignInSession }
  | { type: "usedExisting"; identity: AccountIdentity }
  | { type: "progress"; progress: SignInProgress; signedIn: boolean }
  | { type: "accounts"; signedIn: boolean }
  | { type: "recovered"; sessionId: string; provider?: AccountProvider }
  | { type: "hide" }
  | { type: "show" }
  | { type: "cancelled" }
  | { type: "finish" };

const STEP: Record<SignInProgress["step"], "BROWSER" | "CHECK"> = { waiting_for_browser: "BROWSER", signed_in: "CHECK", checking_plan: "CHECK", sending_test_request: "CHECK", done: "CHECK" };

// @cpt-algo:cpt-noter-algo-ui-accounts-session:p1
export function reduce(s: SignIn, e: SignInEvent): SignIn {
  switch (e.type) {
    case "open":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-prepare
      return { ...closed, phase: "PREPARE", confirmed: s.confirmed };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-prepare
    case "prepared":
      return { ...s, phase: "PREPARE", hidden: false, provider: e.prepare.provider, prepare: e.prepare, cliMissing: false, cliUnsupported: false, installFailed: false, runId: null, choice: e.prepare.existing ? "existing" : "other" };
    case "prepareFailed":
      if (e.code === "cli_missing") return { ...s, phase: "PREPARE", cliMissing: true, cliUnsupported: false, runId: null };
      if (e.code === "cli_version_unsupported") return { ...s, phase: "PREPARE", cliMissing: false, cliUnsupported: true, runId: null };
      return { ...s, phase: "SIGNIN_ERROR", code: e.code };
    case "confirm":
      return { ...s, confirmed: e.on };
    case "choose":
      return { ...s, choice: e.choice };
    case "installStarted":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-install
      return { ...s, phase: "INSTALLING", runId: e.runId, installFailed: false };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-install
    case "installDone":
      // @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-correlate
      return s.phase === "INSTALLING" && s.runId === e.runId ? { ...s, phase: "PREPARE", runId: null } : s;
    // @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-correlate
    case "installFailed":
      return s.phase === "INSTALLING" && s.runId === e.runId ? { ...s, phase: "PREPARE", cliMissing: true, installFailed: true, runId: null } : s;
    case "started":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-browser
      return { ...s, phase: "BROWSER", hidden: false, provider: e.session.provider, session: e.session, sessionId: e.session.id, identity: null, done: false, code: null };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-browser
    case "usedExisting":
      return { ...s, phase: "USE", hidden: false, identity: e.identity, session: null, sessionId: null, done: true };
    case "progress": {
      const p = e.progress;
      // a replaced session or the other provider's progress changes nothing
      if (p.session_id !== s.sessionId || (s.provider && p.provider !== s.provider)) return s;
      // @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-map
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-error
      if (p.error) return { ...s, phase: "SIGNIN_ERROR", code: p.error, session: null };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-error
      const phase = STEP[p.step];
      const done = p.step === "done";
      const identity = p.identity ?? s.identity;
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-check
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-use
      return { ...s, phase: done && e.signedIn ? "USE" : phase, identity, done, session: phase === "BROWSER" ? s.session : null };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-use
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-check
      // @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-map
    }
    case "accounts":
      // done plus a confirmed signed-in accounts state is the only way to Use
      return s.phase === "CHECK" && s.done && e.signedIn ? { ...s, phase: "USE" } : s;
    case "recovered":
      // @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-lifecycle
      return { ...closed, phase: "BROWSER", hidden: true, provider: e.provider ?? null, sessionId: e.sessionId };
    // @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-lifecycle
    case "hide":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-hide
      return s.phase === "SIGNED_OUT" ? s : { ...s, hidden: true };
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-hide
    case "show":
      return { ...s, hidden: false };
    case "cancelled":
    case "finish":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-done
      // @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-clear
      return closed;
      // @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-clear
      // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-done
  }
}

/** The sheet is on screen. */
export const sheetOpen = (s: SignIn): boolean => s.phase !== "SIGNED_OUT" && !s.hidden;

// @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-guard
/** Continue / Use This Account: a supported installed tool, and the personal-use box where the core asks for it. */
export const canContinue = (s: SignIn): boolean => s.phase === "PREPARE" && !!s.prepare && !s.cliMissing && !s.cliUnsupported && s.prepare.cli.installed && s.prepare.cli.supported && (!s.prepare.needs_personal_use_confirmation || s.confirmed);
// @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-guard

/** The stepper's current step: Prepare 0, Sign in 1, Check 2, Use 3 (an error stays where it happened). */
export function stepIndex(s: SignIn): number {
  switch (s.phase) {
    case "BROWSER":
      return 1;
    case "CHECK":
      return 2;
    case "USE":
      return 3;
    case "SIGNIN_ERROR":
      return s.code === "plan_not_eligible" ? 2 : 1;
    default:
      return 0;
  }
}

// @cpt-begin:cpt-noter-algo-ui-accounts-session:p1:inst-countdown
/** Seconds left to show; the core's events, not this number, end a session. */
export const secondsLeft = (expiresAt: number, now: number): number => Math.max(0, Math.ceil((expiresAt - now) / 1000));
// @cpt-end:cpt-noter-algo-ui-accounts-session:p1:inst-countdown
