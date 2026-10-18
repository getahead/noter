// M1 — Delete a call, turn on summary notifications (DESIGN.md 3.6, stories-a).
// One test per story path. The delete alert is a native NSAlert and the notifications prompt
// is the system's: both are XCUITest / macOS checklist steps. Here the call page, the library
// list and the Settings window are driven through their commands (docs/TEST-PLAN.md › M1).
import type { Core, EntityChanged } from "../../src/core/bindings";
import { ahead, ok, pending, refused, until } from "../support/results";
import * as W from "../support/world-presets";
import { changeAhead, expect, given, test } from "./support/fixtures";

/** The ids in the Calls list, or null while calls_list (M1) is not implemented. */
const listIds = async (main: Core) =>
  ahead(await main.callsList({ filter: {}, sort: "newest", page: {} }))?.rows.map((r) => r.id) ?? null;

test.describe("cpt-noter-seq-dialogs-delete-call", () => {
  test("happy path: Delete Call… (⌘⌫), Delete, the call and everything in it gone, Calls list in its place", async ({ scenario }) => {
    await given(scenario, W.idle);
    const main = scenario.core("main");
    const entities = await scenario.events("entity:changed");

    const page = ahead(await main.callGet({ call_id: W.LIVE_CALL })); // the call's page is open
    if (!page) return; // call_get (M1)
    expect(page.call.title).toBe(W.LIVE_TITLE); // Delete “Planning: VHI 8.0 drawer redesign”?
    ahead(await main.windowReportView({ call_id: W.LIVE_CALL })); // M1 command
    const deleted = ahead(await main.callsDelete({ call_ids: [W.LIVE_CALL] })); // Delete
    if (!deleted) return; // calls_delete (M1)
    expect(deleted.deleted).toBe(1);

    await until(() => entities.all.some((e: EntityChanged) => e.type === "removed" && e.kind === "call" && e.id === W.LIVE_CALL), "entity:changed removed");
    expect(refused(await main.callGet({ call_id: W.LIVE_CALL })).code).toBe("not_found"); // removed for good
    const ids = await listIds(main);
    if (ids) expect(ids).not.toContain(W.LIVE_CALL); // the library's Calls list (calls_list, M1)
    ok(await main.windowReportView({ call_id: null }));
  });

  test("error path — Return pressed by habit: Cancel is the default, the call is kept", async ({ scenario }) => {
    // A delete from a window that may not delete is refused before any milestone guard (PM-08).
    expect(refused(await scenario.core("record-prompt").callsDelete({ call_ids: [W.PAST_CALL] })).code).toBe("window_not_allowed");
    const main = scenario.core("main");
    const before = await listIds(main);
    if (!before) return; // calls_list (M1)
    // Return chooses Cancel: no command is sent. The live call cannot be deleted while it records either.
    const live = await main.callsDelete({ call_ids: [W.LIVE_CALL] });
    if (pending(live)) return; // calls_delete (M1)
    expect(refused(live).code).toBe("already_recording");
    expect(await listIds(main)).toEqual(before);
    const past = ahead(await main.callGet({ call_id: W.PAST_CALL }));
    if (past) expect(past.call.id).toBe(W.PAST_CALL); // call_get (M1)
    expect(await listIds(main)).toEqual(before); // the refused deletes changed nothing
  });

  test("other path — Several calls selected: Delete 3 calls?, Delete 3 Calls, the list without them", async ({ scenario }) => {
    let extra: string[] = [];
    if (!(await changeAhead(scenario, "M1", (w) => (extra = W.morePastCalls(w, 2))))) return; // calls (M1)
    const main = scenario.core("main");
    const three = [W.PAST_CALL, ...extra];
    const ids = await listIds(main);
    if (!ids) return; // calls_list (M1)
    expect(ids).toEqual(expect.arrayContaining(three)); // three rows selected with ⌘-click

    const deleted = ahead(await main.callsDelete({ call_ids: three }));
    if (!deleted) return; // calls_delete (M1)
    expect(deleted.deleted).toBe(3);
    const after = (await listIds(main))!;
    three.forEach((id) => expect(after).not.toContain(id));
    expect(after).toContain(W.LIVE_CALL);
  });
});

test.describe("cpt-noter-seq-notifications-allow-notifications", () => {
  test("happy path: Notify Me When Summaries Are Ready, Allow, notifications on and the banner gone", async ({ scenario }) => {
    await given(scenario, W.idle);
    const main = scenario.core("main");
    const env = await scenario.events("env:changed");

    expect(ok(await main.appSnapshot({})).environment.notifications).toBe("not_determined"); // never asked
    ahead(await main.windowReportView({ call_id: W.LIVE_CALL })); // the first recorded call's page (M1 command)
    expect(ok(await main.permissionRequest({ kind: "notifications" })).state).toBe("granted"); // the macOS prompt, Allow
    await until(() => env.latest()?.notifications === "authorized", "env:changed authorized");
    expect(ok(await main.appSnapshot({})).environment.notifications).toBe("authorized");
  });

  test("error path — Notifications not allowed: Don't Allow, then Open Last Summary from the menu", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => W.permission(w, "notifications", "denied"));
    const main = scenario.core("main");
    const nav = await scenario.events("nav:request");

    const denied = refused(await main.permissionRequest({ kind: "notifications" })); // Don't Allow
    expect(denied.code).toBe("permission_denied");
    expect(denied.detail).toEqual({ type: "permission", kind: "notifications" });
    if (!ahead(await main.windowNavigate({ target: { type: "call_page", call_id: W.PAST_CALL, tab: "summary" } }))) return; // Open Last Summary — … (window_navigate, M1)
    await until(() => nav.latest()?.type === "call_page", "that call's outputs");
  });

  test("other path — Turn notifications on later: Notifications are off for Noter, Open System Settings…, Summary ready next time", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => (w.app.environment.notifications = "denied"));
    const settings = scenario.core("settings");
    const env = await scenario.events("env:changed");

    const general = ok(await settings.settingsGet({}));
    expect(ok(await settings.appSnapshot({})).environment.notifications).toBe("denied"); // Notifications are off for Noter
    ahead(await settings.openExternal({ target: { type: "system_settings", permission: "notifications" } })); // M1 command
    await scenario.change((w) => (w.app.environment.notifications = "authorized")); // turned on in System Settings
    await until(() => env.latest()?.notifications === "authorized", "the line gone from General");
    const saved = ok(await settings.settingsUpdate({ rev: general.rev, section: { section: "general", value: { ...general.general, notifications_enabled: true } } }));
    expect(saved.general.notifications_enabled).toBe(true);
  });
});
