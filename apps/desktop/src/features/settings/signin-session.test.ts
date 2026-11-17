import { describe, expect, it } from "vitest";

import type { SignInPrepare, SignInProgress, SignInSession } from "../../core/bindings";
import { canContinue, closed, reduce, secondsLeft, sheetOpen, stepIndex, type SignIn } from "./signin-session";

const cli = { tool: "claude_code" as const, installed: true, path: "/bin/claude", version: "2", supported: true };
const prep = (over: Partial<SignInPrepare> = {}): SignInPrepare => ({ provider: "claude", cli, existing: null, needs_personal_use_confirmation: true, ...over });
const session = (id = "sis_1"): SignInSession => ({ id, provider: "claude", url: "https://x/y", code: "ABCD", expires_at: 1_000_000 });
const prog = (over: Partial<SignInProgress> = {}): SignInProgress => ({ session_id: "sis_1", provider: "claude", step: "waiting_for_browser", identity: null, error: null, ...over });
const ann = { email: "ann@example.com", plan: "Max" };
const run = (events: Parameters<typeof reduce>[1][], from: SignIn = closed): SignIn => events.reduce(reduce, from);

describe("cpt-noter-algo-ui-accounts-session", () => {
  it("opens at Prepare and keeps the Continue guard until the CLI is supported and the personal use is confirmed", () => {
    const s = run([{ type: "open" }, { type: "prepared", prepare: prep() }]);
    expect(s.phase).toBe("PREPARE");
    expect(canContinue(s)).toBe(false);
    expect(canContinue(reduce(s, { type: "confirm", on: true }))).toBe(true);
    const unsupported = run([{ type: "open" }, { type: "prepared", prepare: prep({ cli: { ...cli, supported: false } }) }, { type: "confirm", on: true }]);
    expect(canContinue(unsupported)).toBe(false);
    const chatgpt = run([{ type: "open" }, { type: "prepared", prepare: prep({ needs_personal_use_confirmation: false }) }]);
    expect(canContinue(chatgpt)).toBe(true);
  });

  it("selects the existing account when the CLI has one and lets the user choose another", () => {
    const s = run([{ type: "open" }, { type: "prepared", prepare: prep({ existing: ann }) }]);
    expect(s.choice).toBe("existing");
    expect(reduce(s, { type: "choose", choice: "other" }).choice).toBe("other");
  });

  it("reports a missing CLI from the prepare error and moves through INSTALLING back to PREPARE", () => {
    const missing = run([{ type: "open" }, { type: "prepareFailed", code: "cli_missing" }]);
    expect(missing).toMatchObject({ phase: "PREPARE", cliMissing: true });
    expect(canContinue(missing)).toBe(false);
    const installing = reduce(missing, { type: "installStarted", runId: "run_1" });
    expect(installing.phase).toBe("INSTALLING");
    expect(reduce(installing, { type: "installDone", runId: "run_other" }).phase).toBe("INSTALLING");
    expect(reduce(installing, { type: "installDone", runId: "run_1" }).phase).toBe("PREPARE");
  });

  it("starts the browser step from the returned session and maps the progress steps", () => {
    let s = run([{ type: "open" }, { type: "prepared", prepare: prep() }, { type: "started", session: session() }]);
    expect(s).toMatchObject({ phase: "BROWSER", session: session() });
    expect(stepIndex(s)).toBe(1);
    s = reduce(s, { type: "progress", progress: prog({ step: "checking_plan", identity: ann }), signedIn: false });
    expect(s).toMatchObject({ phase: "CHECK", identity: ann });
    s = reduce(s, { type: "progress", progress: prog({ step: "done", identity: ann }), signedIn: false });
    expect(s.phase).toBe("CHECK"); // done without a confirmed signed-in accounts state does not reach Use
    s = reduce(s, { type: "accounts", signedIn: true });
    expect(s.phase).toBe("USE");
  });

  it("goes to USE on done when the accounts state already says signed in", () => {
    const s = run([{ type: "started", session: session() }, { type: "progress", progress: prog({ step: "done", identity: ann }), signedIn: true }]);
    expect(s.phase).toBe("USE");
  });

  it("ignores progress of another provider or a replaced session", () => {
    const s = run([{ type: "started", session: session("sis_2") }]);
    expect(reduce(s, { type: "progress", progress: prog({ session_id: "sis_1", step: "checking_plan" }), signedIn: false })).toBe(s);
    expect(reduce(s, { type: "progress", progress: prog({ session_id: "sis_2", provider: "chatgpt", step: "done" }), signedIn: true })).toBe(s);
  });

  it("turns a reported error into SIGNIN_ERROR and a new guarded start replaces it", () => {
    const s = run([{ type: "started", session: session() }, { type: "progress", progress: prog({ error: "sign_in_timed_out" }), signedIn: false }]);
    expect(s).toMatchObject({ phase: "SIGNIN_ERROR", code: "sign_in_timed_out" });
    expect(sheetOpen(s)).toBe(true);
    expect(reduce(s, { type: "started", session: session("sis_3") })).toMatchObject({ phase: "BROWSER" });
  });

  it("hides and shows the sheet without losing the session; cancel and finish close it", () => {
    let s = run([{ type: "started", session: session() }, { type: "hide" }]);
    expect(s).toMatchObject({ phase: "BROWSER", hidden: true });
    expect(sheetOpen(s)).toBe(false);
    s = reduce(s, { type: "show" });
    expect(sheetOpen(s)).toBe(true);
    expect(reduce(s, { type: "cancelled" })).toBe(closed);
    expect(reduce(run([{ type: "started", session: session() }, { type: "progress", progress: prog({ step: "done" }), signedIn: true }]), { type: "finish" })).toBe(closed);
  });

  it("recovers a signing_in status after a reload with the session id only and no code or link", () => {
    const s = reduce(closed, { type: "recovered", sessionId: "sis_9" });
    expect(s).toMatchObject({ phase: "BROWSER", hidden: true, session: null, sessionId: "sis_9" });
    expect(reduce(s, { type: "progress", progress: prog({ session_id: "sis_9", step: "signed_in", identity: ann }), signedIn: false }).phase).toBe("CHECK");
  });

  it("derives the countdown from expires_at only for display", () => {
    expect(secondsLeft(1_300_000, 1_000_000)).toBe(300);
    expect(secondsLeft(1_000_000, 1_500_000)).toBe(0);
  });
});
