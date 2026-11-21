// #1057: a refused key removal is said on the row; the key stays stored and the user knows it.
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { removeKey } from "./accounts";
import { KeyFieldRow } from "./CredentialRow";

let bridge: Bridge;
afterEach(() => bridge.close());

it("says so when removing a stored key fails, and the row stays stored", async () => {
  const fake = new FakeCore({ window: "first-run" });
  bridge = createBridge("first-run", fake);
  await bridge.open();
  bridge.core.apiKeyRemove = async () => ({ status: "error", error: { code: "keychain_locked", message: "locked", detail: null, retryable: true } }) as never;
  const view = { provider: "anthropic", status: { type: "configured", verified_at: 0 } } as const;
  const html = () => renderToString(<KeyFieldRow bridge={bridge} view={view} onRemove={() => {}} />);
  expect(html()).not.toContain('role="alert"');
  await removeKey(bridge, "anthropic");
  expect(html()).toContain("Couldn’t remove the key. It is still stored.");
});
