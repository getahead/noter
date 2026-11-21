import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PermissionCheckRow } from "./permission-check-row";
import { NativePermissionDetails } from "./native-permission-details";

it("shows the running copy and actual OS without claiming a signature mismatch", () => {
  expect(renderToStaticMarkup(<NativePermissionDetails />)).toBe("");
  const native = { accent_rgb: [0, 122, 255] as [number, number, number], app_name: "Noter", bundle_id: "ai.noter", app_path: "/tmp/Debug & Test/Noter.app", os_version: "Version 27.2 (Build 26C1)" };
  const html = renderToStaticMarkup(<NativePermissionDetails native={native} />);
  expect(html).toContain("/tmp/Debug &amp; Test/Noter.app");
  expect(html).toContain("ai.noter");
  expect(html).toContain("Version 27.2");
  expect(html).toContain("quit and reopen Noter");
  expect(html).toContain("may not apply");
  expect(renderToStaticMarkup(<NativePermissionDetails native={{ ...native, bundle_id: null }} />)).toContain("Running Noter");
});

it("renders a relaunch requirement explicitly", () => {
  const html = renderToStaticMarkup(<PermissionCheckRow id="sys" label="System audio recording" state="NEEDS_RELAUNCH" />);
  expect(html).toContain("Quit and reopen Noter");
});
