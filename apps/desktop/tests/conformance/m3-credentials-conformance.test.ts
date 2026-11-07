// 2.25 credentials-privacy slice 1 against the real core (TL-32): `api_key_remove`, the Privacy
// pane's `audit_list` and `audit_export`, `account_signin_prepare` and `cli_install` over the
// harness's in-memory Keychain, scripted account CLI (`harness.account_cli`) and scripted
// runtime (`harness.llm_run` writes the audit rows). The scripted CLI, the Keychain stand-in and
// the audit rows exist only in the real core, so the whole file runs on NOTER_CORE=stdio.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AccountsView, WindowLabel, AuditEntry, ExportResult, JobAccepted, JobProgress, KeyProvider, Page, SignInPrepare } from "../../src/core/bindings";
import { isFake } from "../support/core";
import { until } from "../support/results";
import { StdioCore } from "../support/stdio-transport";

const KEY = "sk-conformance-0123456789abcdef";
const PAYLOAD = "Ann agreed to ship the importer behind the blue door.";

const status = (view: AccountsView, provider: KeyProvider) => view.keys.find((k) => k.provider === provider)?.status;

describe.skipIf(isFake)("credentials slice 1 on the real core (2.25)", () => {
  let core: StdioCore;
  let dir: string;
  const call = <T>(window: WindowLabel, cmd: string, args: unknown = {}) => core.invoke(window, cmd as never, args as never) as Promise<T>;
  const control = (name: string, args: unknown = {}) => call("main", `harness.${name}`, args);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "noter-credentials-"));
    core = new StdioCore({ command: `${process.env.NOTER_CORE_CMD}` });
  });
  afterEach(async () => {
    await core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("api_key_remove empties the Keychain item, is Settings only and refuses while the Keychain is locked", async () => {
    await call("settings", "api_key_set", { provider: "anthropic", key: KEY });
    await expect(call("main", "api_key_remove", { provider: "anthropic" })).rejects.toMatchObject({ code: "window_not_allowed" });
    await control("keychain", { locked: true });
    await expect(call("settings", "api_key_remove", { provider: "anthropic" })).rejects.toMatchObject({ code: "keychain_locked" });
    await control("keychain", { locked: false });
    expect(status(await call<AccountsView>("settings", "accounts_get"), "anthropic")).toMatchObject({ type: "configured" });
    const view = await call<AccountsView>("settings", "api_key_remove", { provider: "anthropic" });
    expect(status(view, "anthropic")).toEqual({ type: "not_set" });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("audit_list pages in time order by date, an empty range is empty and only Settings reads", async () => {
    for (let i = 0; i < 3; i++) await control("llm_run", { skill: "post-call", items: [{ id: "seg_1", text: PAYLOAD }] });
    const first = await call<Page<AuditEntry>>("settings", "audit_list", { page: { limit: 2 } });
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0]).toMatchObject({ kind: "run", what: "full_transcript", destination: expect.any(String) });
    expect(first.next_cursor).not.toBeNull();
    const rest = await call<Page<AuditEntry>>("settings", "audit_list", { page: { cursor: first.next_cursor, limit: 2 } });
    expect(rest.rows).toHaveLength(1);
    expect(rest.next_cursor).toBeNull();
    const times = [...first.rows, ...rest.rows].map((r) => r.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect((await call<Page<AuditEntry>>("settings", "audit_list", { from: 9_000_000_000_000, page: {} })).rows).toEqual([]);
    await expect(call("settings", "audit_list", { from: 5, to: 1, page: {} })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(call("main", "audit_list", { page: {} })).rejects.toMatchObject({ code: "window_not_allowed" });
  });

  it("audit_export writes metadata only, a cancelled panel writes nothing and the rows stay", async () => {
    await control("llm_run", { skill: "post-call", items: [{ id: "seg_1", text: PAYLOAD }] });
    const before = await call<Page<AuditEntry>>("settings", "audit_list", { page: {} });
    const json = await call<ExportResult>("settings", "audit_export", { format: "json" });
    const text = readFileSync(json.path, "utf8");
    expect(JSON.parse(text)).toEqual(before.rows);
    expect(text).not.toContain(PAYLOAD);
    const md = await call<ExportResult>("settings", "audit_export", { format: "markdown" });
    expect(readFileSync(md.path, "utf8")).not.toContain(PAYLOAD);
    await control("cancel_next_save_panel");
    await expect(call("settings", "audit_export", { format: "json" })).rejects.toMatchObject({ code: "cancelled" });
    expect(await call<Page<AuditEntry>>("settings", "audit_list", { page: {} })).toEqual(before);
  });

  it("account_signin_prepare reports an existing identity and names a missing CLI", async () => {
    await expect(call("settings", "account_signin_prepare", { provider: "claude" })).rejects.toMatchObject({ code: "cli_missing" });
    await control("account_cli", { tool: "claude_code", installed: true, path: "/bin/claude", version: "2.1.296", identity: { email: "ann@example.com", plan: "Max" } });
    const claude = await call<SignInPrepare>("first-run", "account_signin_prepare", { provider: "claude" });
    expect(claude).toMatchObject({ existing: { email: "ann@example.com" }, needs_personal_use_confirmation: true });
    expect(claude.cli).toMatchObject({ tool: "claude_code", installed: true, version: "2.1.296" });
    await control("account_cli", { tool: "codex", installed: true, version: "9.9.9", supported: false });
    await expect(call("main", "account_signin_prepare", { provider: "chatgpt" })).rejects.toMatchObject({ code: "cli_version_unsupported" });
  });

  it("cli_install runs as a job, a failed install keeps the old one and a retry installs", async () => {
    const runs: JobProgress[] = [];
    core.listen("jobs:progress" as never, (p) => runs.push(p as JobProgress));
    await control("account_cli", { tool: "codex", installed: true, version: "0.163.0", install: { fail: "offline" } });
    const failed = await call<JobAccepted>("settings", "cli_install", { tool: "codex" });
    const failedRun = await until(() => runs.map((r) => r.run).find((r) => r.id === failed.job_run_id && r.status === "failed"), "the failed install run");
    expect(failedRun.error).toBe("offline");
    expect((await call<SignInPrepare>("settings", "account_signin_prepare", { provider: "chatgpt" })).cli.version).toBe("0.163.0");
    await control("account_cli", { tool: "codex", installed: true, version: "0.163.0", install: { version: "0.163.2" } });
    const retry = await call<JobAccepted>("settings", "cli_install", { tool: "codex" });
    await until(() => runs.map((r) => r.run).find((r) => r.id === retry.job_run_id && r.status === "succeeded"), "the retried install run");
    expect((await call<SignInPrepare>("settings", "account_signin_prepare", { provider: "chatgpt" })).cli.version).toBe("0.163.2");
    expect(await control("account_cli_log")).toEqual({ calls: ["install:Codex", "install:Codex"] });
    await expect(call("settings", "cli_install", { tool: "curl" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
