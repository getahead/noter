// M0 — Core bridge and window stores (docs/features/ui/core-bridge.md). The bridge has no screen
// of its own: these flows open the real window frame in the browser over the selected core (the
// fake, or noter-core-harness with NOTER_CORE=stdio; see support/app.ts) and check
// what every screen relies on — snapshot after the event subscriptions, the window states, the
// section-level error with Try Again only when retryable, and nothing kept in browser storage.
// Story: DESIGN-core › Open a window: snapshot, then stream.
import { COMMANDS, CONTRACT_VERSION, EVENTS, type WindowLabel } from "../../src/core/bindings";
import { calls, openWindow, pageErrors } from "./support/app";
import { expect, test } from "./support/fixtures";

const WINDOWS = COMMANDS.app_snapshot.windows as readonly WindowLabel[];
const frame = (page: import("@playwright/test").Page) => page.locator('[data-region="window"]');

test.describe("cpt-noter-seq-core-window-open", () => {
  for (const label of WINDOWS) {
    test(`happy path: the ${label} window subscribes to every event, then takes the snapshot and is ready`, async ({ page }) => {
      const errors = pageErrors(page);
      await openWindow(page, label);
      await expect(frame(page)).toHaveAttribute("data-state", "ready");
      await expect(frame(page)).toHaveAttribute("data-window", label);
      await expect(frame(page)).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("alert")).toHaveCount(0);

      const log = await calls(page);
      const snapshot = log.findIndex((c) => c.kind === "invoke" && c.name === "app_snapshot");
      const listened = log.slice(0, snapshot).filter((c) => c.kind === "listen").map((c) => c.name);
      expect(new Set(listened)).toEqual(new Set(Object.keys(EVENTS))); // no change between the two is lost
      // the snapshot is the first and only one, with no retries and no logs; a window with a screen (first-run) then sends that screen's commands
      const invoked = log.filter((c) => c.kind === "invoke").map((c) => c.name);
      expect(invoked[0]).toBe("app_snapshot");
      expect(invoked.filter((n) => n === "app_snapshot")).toHaveLength(1);
      expect(invoked).not.toContain("log_ui");
      expect(errors).toEqual([]);
    });
  }

  test("other path — reload: the window comes back ready from the core and keeps nothing in browser storage", async ({ page }) => {
    await openWindow(page, "main");
    await expect(frame(page)).toHaveAttribute("data-state", "ready");
    const records = async () => (await frame(page).innerText()).replace(/\d\d:\d\d:\d\d/g, "--:--:--"); // the live call's timer runs
    const before = await records();
    await page.reload();
    await expect(frame(page)).toHaveAttribute("data-state", "ready");
    await expect.poll(records).toBe(before); // the same records after the reload: the core, not the page, kept them
    expect((await calls(page)).filter((c) => c.name === "app_snapshot")).toHaveLength(1); // a fresh store per load
    const storage = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      idb: (await indexedDB.databases()).length,
    }));
    expect(storage).toEqual({ local: 0, session: 0, cookie: "", idb: 0 });
  });

  test("other path — an unknown window label opens as the main window", async ({ page }) => {
    await openWindow(page, "nonsense");
    await expect(frame(page)).toHaveAttribute("data-window", "main");
    await expect(frame(page)).toHaveAttribute("data-state", "ready");
  });

  test("other path — a slow snapshot keeps the window loading until it arrives", async ({ page }) => {
    await openWindow(page, "main", { latency: 1500 });
    await expect(frame(page)).toHaveAttribute("data-state", "loading");
    await expect(frame(page)).toHaveAttribute("aria-busy", "true");
    await expect(frame(page)).toHaveAttribute("data-state", "ready");
  });

  test("error path — the snapshot fails with a retryable error: section-level error, Try Again, then ready", async ({ page }) => {
    await openWindow(page, "main", { fail: [{ cmd: "app_snapshot", code: "not_ready" }] });
    await expect(frame(page)).toHaveAttribute("data-state", "failed");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Something went wrong");
    // The bridge never retries by itself.
    expect((await calls(page)).filter((c) => c.name === "app_snapshot")).toHaveLength(1);
    const logged = (await calls(page)).find((c) => c.name === "log_ui");
    expect(logged?.args).toMatchObject({ level: "warn", code: "not_ready", message: "app_snapshot" });

    await alert.getByRole("button", { name: "Try Again" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await calls(page)).filter((c) => c.name === "app_snapshot")).toHaveLength(2);
  });

  test("error path — the snapshot fails with an error that is not retryable: section-level error without Try Again", async ({ page }) => {
    await openWindow(page, "settings", { fail: [{ cmd: "app_snapshot", code: "window_not_allowed" }] });
    await expect(frame(page)).toHaveAttribute("data-state", "failed");
    await expect(page.getByRole("alert")).toContainText("Something went wrong");
    await expect(page.getByRole("button", { name: "Try Again" })).toHaveCount(0);
    const logged = (await calls(page)).find((c) => c.name === "log_ui");
    expect(logged?.args).toMatchObject({ level: "error", code: "window_not_allowed", message: "app_snapshot" }); // a bug: logged at error
  });

  test("error path — the core's contract major version differs: the window stops, logs the mismatch, no Try Again", async ({ page }) => {
    const theirs = `${Number(CONTRACT_VERSION.split(".")[0]) + 1}.0`;
    await openWindow(page, "call-screen", { contractVersion: theirs });
    await expect(frame(page)).toHaveAttribute("data-state", "failed");
    await expect(page.getByRole("alert")).toContainText("Something went wrong");
    await expect(page.getByRole("button", { name: "Try Again" })).toHaveCount(0);
    const logged = (await calls(page)).find((c) => c.name === "log_ui");
    expect(logged?.args).toMatchObject({ level: "error", code: null, message: `app_snapshot: contract ${theirs}, bindings ${CONTRACT_VERSION}` });
  });
});
