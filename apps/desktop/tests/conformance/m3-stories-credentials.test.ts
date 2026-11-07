// M3 credentials and own-account stories against the real core (Backend Teamlead TL-44): each
// describe names its story and asserts the core-visible steps — account and key states, the
// `accounts:changed` and `signin:progress` events, the settings roles, the `changes`, `settings`
// and `audit_log` rows and the exported file. The scripted Keychain, account CLIs, runtime and
// clock exist only in the real core (`harness.*`), so the fake skips this file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { AccountProvider, AccountsView, AuditEntry, ExportResult, JobProgress, KeyProvider, Page, RuntimeChoice, SignInProgress } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { idle } from "../support/world-presets";

const KEY = "sk-story-key-aaaaaaaaaaaaaaaa";
const BAD = "sk-story-bad-bbbbbbbbbbbbbbbb";
const FIXED = "sk-story-new-cccccccccccccccc";
const CODE = "ONE-TIME-CODE-9137";
const PAYLOAD = "Ann agreed to ship the importer behind the blue door.";
const ANN = { email: "ann@example.com", plan: "Max" };
const BOB = { email: "bob@example.com", plan: "Plus" };

let s: Scenario;
let dir: string;

/** A fresh real core whose scripted runtime follows `script` (one JSON line per answer, in order). */
function open(script: string[] = [], setup?: (w: Parameters<typeof idle>[0]) => void): void {
  dir = mkdtempSync(join(tmpdir(), "noter-credentials-stories-"));
  const command = process.env.NOTER_CORE_CMD!;
  if (script.length) {
    const file = join(dir, "llm.jsonl");
    writeFileSync(file, script.join("\n") + "\n");
    process.env.NOTER_CORE_CMD = `${command} --llm-script ${file}`;
  }
  try {
    s = openScenario({ alsoRecord: exercised, world: setup });
  } finally {
    process.env.NOTER_CORE_CMD = command;
  }
}

/** The scenario's harness: controls are requests on the same wire. */
const harness = () => (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process;
const control = (name: string, args: unknown = {}) => harness().invoke("main", `harness.${name}`, args);
const cli = (tool: string, fields: Record<string, unknown> = {}) => control("account_cli", { tool, installed: true, path: `/bin/${tool}`, version: "2.1.296", ...fields });
const claudeCli = (login: Record<string, unknown> = {}, plan = ANN.plan) =>
  cli("claude_code", { login_identity: { ...ANN, plan }, login: { code: CODE, ...login } });
const codexCli = (login: Record<string, unknown> = {}, plan = BOB.plan) =>
  cli("codex", { version: "0.163.0", login_identity: { ...BOB, plan }, login: { url: "https://chatgpt.com/device", ...login } });

/** Rows of the real core's database, read-only. */
async function rows<T>(sql: string, ...params: string[]): Promise<T[]> {
  const { path } = (await control("data_dir")) as { path: string };
  const db = new DatabaseSync(join(path, "noter.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}
/** Everything the core persisted about accounts, changes and audit, as one string. */
const persisted = async () =>
  JSON.stringify([
    await rows("SELECT before, after, reason, entity_type FROM changes"),
    await rows("SELECT key, value FROM settings"),
    await rows("SELECT what, destination FROM audit_log"),
  ]);

const accounts = async (window: "settings" | "first-run" = "settings"): Promise<AccountsView> => ok(await s.core(window).accountsGet({}));
const keyStatus = (view: AccountsView, provider: KeyProvider) => view.keys.find((k) => k.provider === provider)!.status;
const accountStatus = (view: AccountsView, provider: AccountProvider) => view.accounts.find((a) => a.provider === provider)!.status;
const roles = async () => ok(await s.core("settings").settingsGet({})).runtimes;

async function useRoles(runtime: RuntimeChoice): Promise<void> {
  const current = ok(await s.core("settings").settingsGet({}));
  const value = { ...current.runtimes, live_copilot: runtime, post_call: runtime, search_answers: runtime };
  ok(await s.core("settings").settingsUpdate({ rev: current.rev, section: { section: "runtimes", value } }));
}

/** Signs in as the account's own flow does: prepare, start, then the progress events to the end. */
async function signIn(provider: AccountProvider, window: "settings" | "first-run" = "settings") {
  const progress = await s.events("signin:progress");
  const prepared = ok(await s.core(window).accountSigninPrepare({ provider }));
  const session = ok(await s.core(window).accountSigninStart({ provider, personal_use_confirmed: prepared.needs_personal_use_confirmation }));
  const steps = () => progress.all.filter((p) => p.session_id === session.id);
  return { prepared, session, steps, last: () => steps().at(-1) as SignInProgress };
}
const ended = (steps: () => SignInProgress[]) => until(() => steps().find((p) => p.step === "done" || p.error !== null), "the sign-in to end");

const idleWorld = (w: Parameters<typeof idle>[0]) => idle(w);
/** First run, the Assistants step still open. */
const firstRun = (w: Parameters<typeof idle>[0]) => {
  idle(w);
  w.app.setup.complete = false;
  for (const step of w.app.setup.steps) if (step.step === "assistants") step.state = "todo";
};

afterEach(async () => {
  await s.dispose();
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(isFake)("cpt-noter-seq-first-run-connect-assistant on the real core (2.25)", () => {
  /** Finish: the Assistants step is done or skipped, Today opens and capture still works on the scripted engine. */
  async function finishAndRecord(state: "done" | "skipped") {
    const before = ok(await s.core("first-run").setupStatus({}));
    expect(before.complete).toBe(false);
    const finished = ok(await s.core("first-run").setupSetStep({ step: "assistants", state }));
    expect(finished.complete).toBe(true);
    ok(await s.core("main").todayGet({}));
    const started = ok(await s.core("main").captureStart({ source: "today", sensitive: false }));
    await until(async () => ok(await s.core("main").appSnapshot({})).capture.phase === "recording", "recording");
    expect(ok(await s.core("main").captureStop({ call_id: started.call_id! })).phase).toBe("stopped");
  }

  it("a verified key shows Configured and Finish opens Today with capture working", async () => {
    open([], firstRun);
    const changed = await s.events("accounts:changed");
    const view = ok(await s.core("first-run").apiKeySet({ provider: "anthropic", key: KEY }));
    expect(keyStatus(view, "anthropic")).toMatchObject({ type: "configured" });
    expect(keyStatus(await accounts("first-run"), "anthropic")).toMatchObject({ type: "configured" });
    expect(changed.latest()?.keys.find((k) => k.provider === "anthropic")?.status.type).toBe("configured");
    await finishAndRecord("done");
    expect(await persisted()).not.toContain(KEY);
  });

  it("error — the key is rejected: the field shows the refusal and nothing is stored", async () => {
    open(['{"on": "ask-answer", "fail": "key_rejected"}'], firstRun);
    expect(refused(await s.core("first-run").apiKeySet({ provider: "anthropic", key: BAD })).code).toBe("key_rejected");
    expect(keyStatus(await accounts("first-run"), "anthropic")).toEqual({ type: "rejected", reason: "key_rejected" });
    expect(await persisted()).not.toContain(BAD);
  });

  it("other — sign in with your own account: a checked account counts as connected at Finish", async () => {
    open([], firstRun);
    await claudeCli();
    const run = await signIn("claude", "first-run");
    expect(run.prepared).toMatchObject({ existing: null, needs_personal_use_confirmation: true, cli: { tool: "claude_code", installed: true } });
    expect(run.session).toMatchObject({ provider: "claude", code: CODE });
    await ended(run.steps);
    expect(run.steps().map((p) => p.step)).toEqual(["waiting_for_browser", "signed_in", "checking_plan", "sending_test_request", "done"]);
    expect(accountStatus(await accounts("first-run"), "claude")).toMatchObject({ type: "signed_in", identity: ANN });
    await finishAndRecord("done");
    expect(await persisted()).not.toContain(CODE);
  });

  it("empty — no key and no local runtime: Finish without an assistant still completes, Today opens and capture works", async () => {
    open([], firstRun);
    const view = await accounts("first-run");
    expect(view.keys.every((k) => k.status.type === "not_set")).toBe(true);
    expect(view.accounts.every((a) => a.status.type === "not_signed_in")).toBe(true);
    await finishAndRecord("skipped");
  });
});

describe.skipIf(isFake)("cpt-noter-seq-settings-replace-api-key on the real core (2.25)", () => {
  it("rejection, a locked Keychain and a corrected key report distinct states; a failed replacement keeps the working key; remove empties it", async () => {
    open(['{"on": "ask-answer"}', '{"on": "ask-answer", "fail": "key_rejected"}', '{"on": "ask-answer"}']);
    const changed = await s.events("accounts:changed");
    const first = ok(await s.core("settings").apiKeySet({ provider: "anthropic", key: KEY }));
    expect(keyStatus(first, "anthropic")).toMatchObject({ type: "configured" });
    // Rejected: the call says so, the previous key stays configured.
    expect(refused(await s.core("settings").apiKeySet({ provider: "anthropic", key: BAD })).code).toBe("key_rejected");
    expect(keyStatus(await accounts(), "anthropic")).toMatchObject({ type: "configured" });
    // Locked Keychain: a different refusal and a different state; nothing was replaced.
    await control("keychain", { locked: true });
    expect(refused(await s.core("settings").apiKeySet({ provider: "anthropic", key: FIXED })).code).toBe("keychain_locked");
    expect(keyStatus(await accounts(), "anthropic")).toEqual({ type: "keychain_locked" });
    await control("keychain", { locked: false });
    // The corrected key replaces the old one.
    const fixed = ok(await s.core("settings").apiKeySet({ provider: "anthropic", key: FIXED }));
    expect(keyStatus(fixed, "anthropic")).toMatchObject({ type: "configured" });
    // The second provider is independent.
    expect(keyStatus(fixed, "codex")).toEqual({ type: "not_set" });
    // Remove empties the Keychain item.
    expect(keyStatus(ok(await s.core("settings").apiKeyRemove({ provider: "anthropic" })), "anthropic")).toEqual({ type: "not_set" });
    // No secret anywhere: results, events, change rows, settings rows, audit rows.
    await control("llm_run", { skill: "post-call", items: [{ id: "seg_1", text: PAYLOAD }] });
    const seen = JSON.stringify([first, fixed, changed.all]) + (await persisted());
    for (const secret of [KEY, BAD, FIXED]) expect(seen).not.toContain(secret);
    expect(changed.all.length).toBeGreaterThan(1);
  });
});

describe.skipIf(isFake)("cpt-noter-seq-settings-sign-in-account on the real core (2.25)", () => {
  it("both providers sign in independently with their own progress", async () => {
    open();
    await claudeCli({ delay_ms: 150 });
    await codexCli({ delay_ms: 50 });
    const claude = await signIn("claude");
    const chatgpt = await signIn("chatgpt");
    expect(chatgpt.prepared.needs_personal_use_confirmation).toBe(false);
    expect(chatgpt.session).toMatchObject({ provider: "chatgpt", url: "https://chatgpt.com/device", code: null });
    expect(chatgpt.session.expires_at - claude.session.expires_at).toBeLessThan(5_000);
    await ended(chatgpt.steps);
    expect(accountStatus(await accounts(), "chatgpt")).toMatchObject({ type: "signed_in", identity: BOB });
    expect(accountStatus(await accounts(), "claude")).toMatchObject({ type: "signing_in" });
    await ended(claude.steps);
    expect(accountStatus(await accounts(), "claude")).toMatchObject({ type: "signed_in", identity: ANN });
    expect(claude.steps().at(-1)!.step).toBe("done");
    expect(await control("account_cli_log")).toEqual({ calls: ["login:Claude", "login:Chatgpt"] });
    expect(await persisted()).not.toContain(CODE);
  });

  it("the five-minute window is one clock: a browser result after it is rejected and binds nothing", async () => {
    open();
    await claudeCli({ delay_ms: 400 });
    const run = await signIn("claude");
    const { now } = (await control("advance_clock", { ms: 0 })) as { now: number };
    expect(run.session.expires_at).toBeGreaterThan(now);
    expect(run.session.expires_at - now).toBeLessThanOrEqual(300_000);
    expect(run.session.expires_at - now).toBeGreaterThan(299_000);
    await control("advance_clock", { ms: 301_000 });
    const end = await ended(run.steps);
    expect(end).toMatchObject({ step: "signed_in", error: "sign_in_timed_out" });
    expect(run.steps().map((p) => p.step)).not.toContain("done");
    expect(accountStatus(await accounts(), "claude")).toEqual({ type: "not_signed_in" });
    // A new sign-in starts a new window and succeeds.
    await claudeCli();
    const again = await signIn("claude");
    await ended(again.steps);
    expect(again.last().step).toBe("done");
  });

  it("cancel, offline and an ineligible plan leave the bindings untouched", async () => {
    open(['{"on": "ask-answer", "fail": "offline"}']);
    const before = await accounts();
    // Cancel while the browser is open.
    await claudeCli({ delay_ms: 60_000 });
    const pending = await signIn("claude");
    const cancelled = ok(await s.core("settings").accountSigninCancel({ session_id: pending.session.id }));
    expect(accountStatus(cancelled, "claude")).toEqual({ type: "not_signed_in" });
    expect(pending.last()).toMatchObject({ error: "sign_in_cancelled" });
    // Offline at the test request.
    await claudeCli();
    const offline = await signIn("claude");
    expect((await ended(offline.steps)).error).toBe("offline");
    // A plan the provider does not allow.
    await codexCli({}, "Free");
    const free = await signIn("chatgpt");
    expect((await ended(free.steps)).error).toBe("plan_not_eligible");
    expect(await accounts()).toMatchObject({ accounts: before.accounts, keys: before.keys });
    expect(await rows("SELECT value FROM settings WHERE key = 'accounts'")).toEqual([]);
  });

  it("use an existing sign-in, test it, bind and Undo, install the CLI; sign out falls back to the key runtime", async () => {
    open(['{"on": "ask-answer"}', '{"on": "ask-answer", "after_ms": 20}', '{"on": "ask-answer"}']);
    // Use This Account: the tool is already signed in on this Mac, no browser.
    await cli("codex", { version: "0.163.0", identity: BOB });
    const prepared = ok(await s.core("settings").accountSigninPrepare({ provider: "chatgpt" }));
    expect(prepared.existing).toEqual(BOB);
    const used = ok(await s.core("settings").accountUseExisting({ provider: "chatgpt" }));
    expect(accountStatus(used, "chatgpt")).toMatchObject({ type: "signed_in", identity: BOB });
    // The test request reports ok and its latency.
    expect(ok(await s.core("settings").accountTest({ provider: "chatgpt" }))).toMatchObject({ ok: true, error: null });
    // Bind: the preference is one undoable change; Undo restores it. Agent ids need core-agents (M4).
    const preference = async () => JSON.stringify(await rows("SELECT value FROM settings WHERE key = 'accounts'"));
    const unbound = await preference();
    const bound = ok(await s.core("settings").accountBindAgents({ provider: "chatgpt", agent_ids: [], default_for_new_agents: true }));
    expect(bound.change_id).toBeTruthy();
    expect(await preference()).not.toEqual(unbound);
    expect(refused(await s.core("settings").accountBindAgents({ provider: "chatgpt", agent_ids: ["agt_missing"], default_for_new_agents: false })).code).toBe("not_found");
    ok(await s.core("main").changeUndo({ target: { type: "change", change_id: bound.change_id } }));
    expect(await preference()).toEqual(unbound);
    // CLI install runs as a job.
    const jobs = await s.events("jobs:progress");
    await cli("claude_code", { version: "2.1.296", install: { version: "2.1.300" } });
    const job = ok(await s.core("settings").cliInstall({ tool: "claude_code" }));
    await until(() => jobs.all.map((j) => j.run).find((r) => r.id === job.job_run_id && r.status === "succeeded"), "the install job");
    // Sign out: roles on the account fall back to its API-key runtime; the account is signed out.
    expect(keyStatus(ok(await s.core("settings").apiKeySet({ provider: "codex", key: KEY })), "codex")).toMatchObject({ type: "configured" });
    await useRoles("chatgpt_account");
    expect(await roles()).toMatchObject({ post_call: "chatgpt_account" });
    const out = ok(await s.core("settings").accountSignOut({ provider: "chatgpt", also_in_cli: false }));
    expect(accountStatus(out, "chatgpt")).toEqual({ type: "not_signed_in" });
    expect(await roles()).toMatchObject({ live_copilot: "codex_api_key", post_call: "codex_api_key", search_answers: "codex_api_key" });
  });

  it("a sign-in that the provider ended pauses the account without unbinding its roles", async () => {
    open();
    await codexCli();
    const run = await signIn("chatgpt");
    await ended(run.steps);
    await useRoles("chatgpt_account");
    await cli("codex", { version: "0.163.0", identity: null });
    await until(async () => accountStatus(await accounts(), "chatgpt").type === "signed_out_by_provider", "the provider-ended pause");
    expect(await roles()).toMatchObject({ post_call: "chatgpt_account" });
  });
});

describe.skipIf(isFake)("cpt-noter-seq-settings-check-privacy on the real core (2.25)", () => {
  const auditList = async (args: { from?: number; to?: number; cursor?: string | null; limit?: number } = {}) =>
    ok(await s.core("settings").auditList({ from: args.from ?? null, to: args.to ?? null, page: { cursor: args.cursor ?? null, limit: args.limit ?? 50 } })) as Page<AuditEntry>;

  it("date-filtered audit rows keep kind, run, bytes and destination in stable order and page by cursor; an empty range is empty", async () => {
    open();
    ok(await s.core("settings").apiKeySet({ provider: "anthropic", key: KEY }));
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push((await control("llm_run", { skill: "post-call", items: [{ id: "seg_1", text: PAYLOAD }] })) as { llm_run_id: string });
    const all = await auditList();
    const ids = runs.map((r) => r.llm_run_id);
    expect(all.rows.filter((r) => ids.includes(r.llm_run_id!)).map((r) => r.llm_run_id)).toEqual(ids);
    for (const row of all.rows.filter((x) => ids.includes(x.llm_run_id!))) expect(row).toMatchObject({ kind: "run", what: "full_transcript", destination: "api.anthropic.com", runtime: "claude_api_key" });
    expect(all.rows.every((r) => r.bytes_out > 0)).toBe(true);
    // Order is stable and the pages cover the same rows.
    const first = await auditList({ limit: 2 });
    const rest = await auditList({ limit: 2, cursor: first.next_cursor });
    expect([...first.rows, ...rest.rows]).toEqual(all.rows);
    expect(rest.next_cursor).toBeNull();
    expect(await auditList()).toEqual(all);
    // A range around the rows keeps them, one after them is empty.
    const at = all.rows.map((r) => r.at);
    expect((await auditList({ from: Math.min(...at), to: Math.max(...at) })).rows).toEqual(all.rows);
    expect((await auditList({ from: Math.max(...at) + 1 })).rows).toEqual([]);
  });

  it("export (Markdown and JSON) holds the metadata and no payload, key or audio; a cancelled panel writes nothing; moving storage does not ship", async () => {
    open();
    ok(await s.core("settings").apiKeySet({ provider: "anthropic", key: KEY }));
    await control("llm_run", { skill: "post-call", items: [{ id: "seg_1", text: PAYLOAD }] });
    const listed = await auditList();
    const json = ok(await s.core("settings").auditExport({ format: "json" })) as ExportResult;
    expect(json.path).toContain("exports");
    const text = readFileSync(json.path, "utf8");
    expect(JSON.parse(text)).toEqual(listed.rows);
    const md = ok(await s.core("settings").auditExport({ format: "markdown" })) as ExportResult;
    const markdown = readFileSync(md.path, "utf8");
    expect(markdown).toContain("api.anthropic.com");
    expect(markdown).toContain(String(listed.rows[0].bytes_out));
    for (const out of [text, markdown]) for (const secret of [PAYLOAD, KEY, "audio/"]) expect(out).not.toContain(secret);
    await control("cancel_next_save_panel");
    expect(refused(await s.core("settings").auditExport({ format: "json" })).code).toBe("cancelled");
    expect(await auditList()).toEqual(listed);
    expect(refused(await s.core("settings").storageMove({ path: null })).code).toBe("not_implemented");
  });
});
