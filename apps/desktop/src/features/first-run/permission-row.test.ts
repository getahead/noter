import { describe, expect, it } from "vitest";
import type { PermissionState } from "../../core/bindings";
import { initialPermissionRow, permissionRowNext, type PermissionRowEvent, type PermissionRowState } from "./permission-row";

describe("initialPermissionRow", () => {
  it("maps what the core reports, with system audio missing rather than not asked", () => {
    expect(initialPermissionRow("microphone", "not_asked")).toBe("NOT_ASKED");
    expect(initialPermissionRow("system_audio", "not_asked")).toBe("MISSING");
    expect(initialPermissionRow("microphone", "granted")).toBe("GRANTED");
    expect(initialPermissionRow("system_audio", "denied")).toBe("DENIED");
    expect(initialPermissionRow("microphone", "needs_relaunch")).toBe("MISSING");
  });
});

describe("permissionRowNext (cpt-noter-state-ui-first-run-permission-row)", () => {
  const table: [PermissionRowState, PermissionRowEvent, PermissionRowState][] = [
    ["NOT_ASKED", { type: "prompt_answered", granted: true }, "GRANTED"],
    ["NOT_ASKED", { type: "prompt_answered", granted: false }, "DENIED"],
    ["MISSING", { type: "returned_from_settings" }, "CHECKING"],
    ["DENIED", { type: "returned_from_settings" }, "CHECKING"],
    ["CHECKING", { type: "read", state: "granted" }, "GRANTED"],
    ["CHECKING", { type: "read", state: "not_asked" }, "MISSING"],
    ["CHECKING", { type: "read", state: "denied" }, "MISSING"],
  ];
  it.each(table)("%s on %j is %s", (from, event, to) => expect(permissionRowNext(from, event)).toBe(to));

  it("ignores every event outside those transitions", () => {
    const states: PermissionRowState[] = ["NOT_ASKED", "MISSING", "CHECKING", "GRANTED", "DENIED"];
    const events: PermissionRowEvent[] = [{ type: "prompt_answered", granted: true }, { type: "returned_from_settings" }, { type: "read", state: "granted" as PermissionState }];
    for (const s of states) for (const e of events) {
      if (!table.some(([f, ev]) => f === s && ev.type === e.type)) expect(permissionRowNext(s, e)).toBe(s);
    }
  });
});
