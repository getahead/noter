// The sign-in sheet over the fake core (cpt-noter-dod-ui-accounts-sign-in): each provider on its own machine, the
// guard before Continue, the code from the core only, hide/show without a cancel, errors, Use and Undo.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { sentCommands } from "../../../tests/support/fake-core";
import { find, rendered } from "../../ui/testing";
import { loadAccounts } from "./accounts";
import { AccountSignInSheet } from "./AccountSignInSheet";
import { canContinue } from "./signin-session";
import { signInMachines } from "./signin-store";

let bridge: Bridge;
afterEach(() => bridge.close());
async function ready(seed?: (w: FakeCore["world"]) => void) {
  const fake = new FakeCore({ window: "settings" });
  for (const a of fake.world.app.accounts.accounts) Object.assign(a.cli, { installed: true, supported: true, path: "/bin/tool", version: "1" });
  seed?.(fake.world);
  bridge = createBridge("settings", fake);
  await bridge.open();
  await loadAccounts(bridge);
  return { fake, seen: sentCommands(fake) };
}
const view = (p: "claude" | "chatgpt") => bridge.store.getState().whole.accounts!.accounts.find((a) => a.provider === p)!;
const html = (p: "claude" | "chatgpt") => renderToString(<AccountSignInSheet bridge={bridge} provider={p} view={view(p)} />);
const m = () => signInMachines(bridge);
const press = (p: "claude" | "chatgpt", label: string) => {
  const tree = rendered(AccountSignInSheet, { bridge, provider: p, view: view(p) });
  const hit = (x: Record<string, unknown>) => (x.label === label || x.ariaLabel === label) && typeof x.onAction === "function";
  const footer = find(tree, (x) => x.defaultButton !== undefined).props.defaultButton as Parameters<typeof find>[0];
  const el = hit((footer as { props: Record<string, unknown> }).props) ? (footer as { props: Record<string, unknown> }) : find(tree, hit);
  (("props" in el ? el.props : el).onAction as () => void)();
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AccountSignInSheet", () => {
  it("renders nothing until Sign In opens it, then Prepare with the facts and the Claude-only personal-use box", async () => {
    await ready();
    expect(html("claude")).toBe("");
    await m().open("claude");
    const claude = html("claude");
    expect(claude).toContain("Sign in with your Claude account");
    expect(claude).toContain("Noter never sees your password");
    expect(claude).toContain("I’ll use my Claude account only for my own work");
    expect(claude).toContain('data-variant="sign-in-claude"');
    expect(html("chatgpt")).toBe(""); // the other provider is independent
    await m().open("chatgpt");
    expect(html("chatgpt")).not.toContain("only for my own work");
  });

  it("keeps Continue disabled until the box is ticked, then starts the browser step and shows the returned code", async () => {
    const { seen } = await ready();
    await m().open("claude");
    expect(m().state.claude.phase).toBe("PREPARE");
    expect(canContinue(m().state.claude)).toBe(false);
    m().dispatch("claude", { type: "confirm", on: true });
    // the fake offers an existing Claude login: choose the browser path
    m().dispatch("claude", { type: "choose", choice: "other" });
    await m().proceed("claude");
    expect(seen).toContainEqual(["account_signin_start", { provider: "claude", personal_use_confirmed: true }]);
    expect(m().state.claude.phase).toBe("BROWSER");
    expect(html("claude")).toContain("ABCD-EFGH");
    expect(html("claude")).toContain("Waiting for your browser…");
  });

  it("hides on Esc without cancelling, Show restores it and Cancel sends account_signin_cancel", async () => {
    const { seen } = await ready();
    await m().open("chatgpt");
    await m().proceed("chatgpt");
    expect(m().state.chatgpt.phase).toBe("BROWSER");
    m().dispatch("chatgpt", { type: "hide" });
    expect(html("chatgpt")).toBe("");
    expect(seen.map(([c]) => c)).not.toContain("account_signin_cancel");
    m().dispatch("chatgpt", { type: "show" });
    expect(html("chatgpt")).toContain("Waiting for your browser…");
    press("chatgpt", "Cancel");
    await vi.waitFor(() => expect(seen.map(([c]) => c)).toContain("account_signin_cancel"));
    expect(m().state.chatgpt.phase).toBe("SIGNED_OUT");
  });

  it("walks the core's progress to Check and Use, then Use binds and clears the sheet", async () => {
    const { seen } = await ready();
    await m().open("chatgpt");
    await m().proceed("chatgpt");
    await vi.waitFor(() => expect(m().state.chatgpt.phase).toBe("USE"), { timeout: 8000 });
    expect(html("chatgpt")).toContain("Connected to your ChatGPT account");
    expect(html("chatgpt")).toContain("Offer your ChatGPT account first when adding an agent");
    press("chatgpt", "Done");
    await vi.waitFor(() => expect(seen.map(([c]) => c)).toContain("account_bind_agents"));
    await vi.waitFor(() => expect(m().state.chatgpt.phase).toBe("SIGNED_OUT"));
  }, 15000);

  it("shows the error body of a progress error and retries only on the user's click", async () => {
    await ready();
    await m().open("chatgpt");
    await m().proceed("chatgpt");
    const id = m().state.chatgpt.sessionId!;
    bridge.store.setState((s) => ({ ...s, signin: { ...s.signin, [id]: { session_id: id, provider: "chatgpt", step: "waiting_for_browser", identity: null, error: "plan_not_eligible" } } }));
    await tick();
    const body = html("chatgpt");
    expect(m().state.chatgpt.phase).toBe("SIGNIN_ERROR");
    expect(body).toContain("has no ChatGPT Plus, Pro, Business or Enterprise plan");
    expect(body).toContain("Use Another Account");
  });

  it("reuses an existing CLI account without a browser", async () => {
    const { seen } = await ready();
    await m().open("claude");
    expect(m().state.claude.choice).toBe("existing");
    expect(html("claude")).toContain("Use you@example.com");
    m().dispatch("claude", { type: "confirm", on: true });
    await m().proceed("claude");
    expect(seen.map(([c]) => c)).toContain("account_use_existing");
    expect(seen.find(([c]) => c === "account_use_existing")?.[1]).toEqual({ provider: "claude", personal_use_confirmed: true }); // #1000: the ticked box goes with the request
    expect(seen.map(([c]) => c)).not.toContain("account_signin_start");
    expect(m().state.claude.phase).toBe("USE");
  });

  it("#1000: a refused Use This Account shows the error, never a silent no-op", async () => {
    const { fake } = await ready();
    await m().open("claude");
    m().dispatch("claude", { type: "confirm", on: true });
    fake.failNext("account_use_existing", "personal_use_not_confirmed");
    await m().proceed("claude");
    expect(m().state.claude.phase).toBe("SIGNIN_ERROR");
    expect(html("claude")).toContain("Something went wrong");
  });

  it("a failed install shows the error instead of staying on Prepare", async () => {
    const { fake } = await ready();
    await m().open("claude");
    m().dispatch("claude", { type: "prepareFailed", code: "cli_missing" });
    fake.failNext("cli_install", "offline");
    await m().install("claude");
    expect(m().state.claude.phase).toBe("SIGNIN_ERROR");
    expect(m().state.claude.code).toBe("offline");
  });

  it("says a missing CLI can be installed and returns to Prepare after the install job", async () => {
    const { seen } = await ready();
    await m().open("claude");
    m().dispatch("claude", { type: "prepareFailed", code: "cli_missing" });
    expect(html("claude")).toContain("Claude Code isn’t installed");
    await m().install("claude");
    expect(seen.map(([c]) => c)).toContain("cli_install");
    expect(m().state.claude.phase).toBe("INSTALLING");
    await vi.waitFor(() => expect(m().state.claude.phase).toBe("PREPARE"), { timeout: 8000 });
  }, 15000);

  it("shows the install error with Install again after a failed install job, and the unsupported copy for cli_version_unsupported", async () => {
    await ready();
    await m().open("claude");
    m().dispatch("claude", { type: "prepareFailed", code: "cli_missing" });
    m().dispatch("claude", { type: "installStarted", runId: "run_x" });
    m().dispatch("claude", { type: "installFailed", runId: "run_x" });
    expect(html("claude")).toContain("didn’t finish");
    expect(html("claude")).toContain("Install Claude Code");
    m().dispatch("claude", { type: "prepareFailed", code: "cli_version_unsupported" });
    expect(html("claude")).toContain("This version of Claude Code isn’t supported");
    expect(html("claude")).not.toContain("Something went wrong");
  });

  it("recovers a signing_in row after a reload with Show and no code", async () => {
    await ready((w) => {
      w.app.accounts.accounts.find((a) => a.provider === "claude")!.status = { type: "signing_in", session_id: "sis_77" };
    });
    await loadAccounts(bridge);
    expect(m().state.claude).toMatchObject({ phase: "BROWSER", hidden: true, sessionId: "sis_77" });
    m().dispatch("claude", { type: "show" });
    expect(html("claude")).toContain("can’t be shown again");
  });
});
