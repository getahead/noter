import { describe, expect, it } from "vitest";
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
    ["MISSING", { type: "returned_from_settings" }, "CHECKING"],
    ["DENIED", { type: "returned_from_settings" }, "CHECKING"],
    ["GRANTED", { type: "self_test_zero_buffers" }, "MISSING"],
    ["CHECKING", { type: "self_test_zero_buffers" }, "MISSING"],
    ["NOT_ASKED", { type: "self_test_zero_buffers" }, "MISSING"],
  ];
  it.each(table)("%s on %j is %s", (from, event, to) => expect(permissionRowNext(from, event)).toBe(to));

  it("ignores every event outside those transitions", () => {
    const states: PermissionRowState[] = ["NOT_ASKED", "MISSING", "CHECKING", "GRANTED", "DENIED"];
    const events: PermissionRowEvent[] = [{ type: "returned_from_settings" }];
    for (const s of states) for (const e of events) {
      if (!table.some(([f, ev]) => f === s && ev.type === e.type)) expect(permissionRowNext(s, e)).toBe(s);
    }
  });
});
