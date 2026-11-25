// #1219 (owner, 23 Nov): a Codex or Claude Code newer than the version Noter was tested with runs, and the
// sign-in sheet and the account row say it hasn't been tested (cpt-noter-dod-ui-accounts-sign-in).
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CliInfo } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { loadAccounts } from "./accounts";
import { untestedText } from "./account-rows";
import { AccountSignInSheet } from "./AccountSignInSheet";
import { AccountRow } from "./CredentialRow";
import { signInMachines } from "./signin-store";

const WARNING = "Codex 0.171.0 hasn’t been tested with Noter yet. It should work; if something fails, update Noter, or use Codex 0.163.";
const codex = (over: Partial<CliInfo> = {}): CliInfo => ({ tool: "codex", installed: true, path: "/bin/codex", version: "0.171.0", supported: true, untested: true, tested: "0.163.0", ...over });

let bridge: Bridge;
afterEach(() => bridge?.close());

describe("an untested newer CLI (issue 1219)", () => {
  it("cpt-noter-seq-settings-sign-in-account: names the version and points to a Noter update or the tested version, never to the API key (issue 1247: a key runs through the same tool)", () => {
    expect(untestedText("chatgpt", codex())).toBe(WARNING);
    expect(untestedText("claude", codex({ version: "2.4.1", tested: "2.1.296" }))).not.toContain("API key");
    expect(untestedText("chatgpt", codex({ untested: false }))).toBeNull();
    expect(untestedText("chatgpt", codex({ tested: null }))).toBeNull();
  });

  it("warns in the sign-in sheet and in the account row, and the sheet still lets the user sign in", async () => {
    const fake = new FakeCore({ window: "settings" });
    const row = fake.world.app.accounts.accounts.find((a) => a.provider === "chatgpt")!;
    row.cli = codex();
    bridge = createBridge("settings", fake);
    await bridge.open();
    await loadAccounts(bridge);
    const view = bridge.store.getState().whole.accounts!.accounts.find((a) => a.provider === "chatgpt")!;
    expect(renderToString(<AccountRow bridge={bridge} view={view} keyConfigured={false} />)).toContain(WARNING);
    await signInMachines(bridge).open("chatgpt");
    const sheet = renderToString(<AccountSignInSheet bridge={bridge} provider="chatgpt" view={view} />);
    expect(sheet).toContain(WARNING);
    expect(sheet).not.toContain("isn’t supported");
  });
});
