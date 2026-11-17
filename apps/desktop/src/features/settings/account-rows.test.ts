import { describe, expect, it } from "vitest";

import type { AccountsView, AccountView } from "../../core/bindings";
import { accountRowState, signOutCopy, testResultText, usedByText, expiredNoteText, visibleTestLine } from "./account-rows";
import { runtimeConnected } from "./keys";

const view = (status: AccountView["status"], agents: AccountView["agents"] = []): AccountView => ({
  provider: "claude",
  status,
  cli: { tool: "claude_code", installed: true, path: null, version: null, supported: true },
  agents,
});
const ag = (name: string) => ({ id: `agt_${name}`, name, badge: "agent" });

describe("accountRowState (cpt-noter-state-ui-accounts-credentials)", () => {
  it("maps the core's status to the row state", () => {
    expect(accountRowState(view({ type: "not_signed_in" }))).toBe("not_signed_in");
    expect(accountRowState(view({ type: "signing_in", session_id: "sis_1" }))).toBe("signing_in");
    expect(accountRowState(view({ type: "signed_in", identity: { email: "a@b.c", plan: "Max" }, since: 1 }))).toBe("signed_in");
    expect(accountRowState(view({ type: "signed_out_by_provider", at: 1 }))).toBe("expired");
  });
});

describe("usedByText", () => {
  it("names the agents or says none uses the account", () => {
    expect(usedByText([])).toBe("No agent uses it yet. Choose it in Agents, or for a task below.");
    expect(usedByText([ag("Product manager"), ag("Architect")])).toBe("Used by 2 agents: Product manager, Architect");
    expect(usedByText([ag("Architect")])).toBe("Used by 1 agent: Architect");
  });
});

describe("signOutCopy", () => {
  it("says the agents switch back to the key, or pause when there is none", () => {
    const withKey = signOutCopy("claude", [ag("Product manager"), ag("Architect")], true);
    expect(withKey.title).toBe("Sign out of your Claude account in Noter?");
    expect(withKey.message).toContain("Product manager, Architect switch back to the Anthropic API key.");
    expect(withKey.message).toContain("Claude Code stays signed in for your own terminal use.");
    expect(withKey.checkbox).toBe("Also sign out of Claude Code on this Mac");
    const noKey = signOutCopy("chatgpt", [ag("Architect")], false);
    expect(noKey.message).toContain("Architect switches back to the Codex API key, which isn’t set, so it pauses.");
    expect(noKey.checkbox).toBe("Also sign out of Codex on this Mac");
  });

  it("names no agents when none uses the account", () => {
    expect(signOutCopy("claude", [], true).message).toBe("Claude Code stays signed in for your own terminal use.");
  });
});

describe("testResultText", () => {
  it("shows the latency only when the test is ok, else the mapped error", () => {
    expect(testResultText({ ok: true, latency_ms: 1800, error: null })).toBe("Answered in 1.8 s");
    expect(testResultText({ ok: false, latency_ms: 20, error: "offline" })).toBe("Couldn’t reach the provider. Check your connection.");
    expect(testResultText({ ok: false, latency_ms: null, error: "account_signed_out" })).toBe("The account is signed out. Sign in again.");
    expect(testResultText({ ok: false, latency_ms: null, error: null })).toBe("The test failed.");
  });
});

describe("runtimeConnected for accounts", () => {
  it("counts an account runtime once it is signed in", () => {
    const a = { version: 1, keys: [], local: { running: false } as AccountsView["local"], accounts: [view({ type: "signed_in", identity: { email: "a@b.c", plan: "Max" }, since: 1 })] } as AccountsView;
    expect(runtimeConnected("claude_account", a)).toBe(true);
    expect(runtimeConnected("chatgpt_account", a)).toBe(false);
  });
});

describe("expiredNoteText and visibleTestLine", () => {
  it("counts the paused agents, none: the plain note", () => {
    expect(expiredNoteText("Claude", [])).toBe("Claude ended the session for this account. Agents on it are paused until you sign in again.");
    expect(expiredNoteText("Claude", [{ id: "a", name: "A", badge: "agent" }])).toContain("1 agent paused");
    expect(expiredNoteText("Claude", [{ id: "a", name: "A", badge: "agent" }, { id: "b", name: "B", badge: "agent" }])).toContain("2 agents paused");
  });
  it("shows a Test answer only on a signed-in row", () => {
    expect(visibleTestLine("signed_in", "Works")).toBe("Works");
    for (const s of ["expired", "not_signed_in", "signing_in"] as const) expect(visibleTestLine(s, "Works")).toBeNull();
  });
});
