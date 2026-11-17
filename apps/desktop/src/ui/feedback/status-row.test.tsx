import { renderToString } from "react-dom/server";
import { vi } from "vitest";
import { find, rendered } from "../testing";
import { describe, expect, it } from "vitest";
import { StatusRow } from "./status-row";

describe("StatusRow", () => {
  it("shows icon, word, title, subtitle, message and actions", () => {
    const html = renderToString(<StatusRow tone="err" icon="error" word="Failed" title="Docs" subtitle="Last sync 9:00" message="Folder missing" tag="Folder" actions={<button>Try Again</button>} />);
    expect(html).toContain("Failed");
    expect(html).toContain("Folder missing");
    expect(html).toContain("Try Again");
    expect(html).toContain('data-component="cpt-noter-component-ui-status-row"');
    expect(html).toContain('data-state="err"');
  });
  it("running hides actions and message, and shows the progress", () => {
    const html = renderToString(<StatusRow tone="ok" word="Running…" title="Docs" message="x" progress={{ done: 3, total: 12 }} actions={<button>Re-index</button>} />);
    expect(html).not.toContain("Re-index");
    expect(html).not.toContain(">x<");
    expect(html).toContain("3 of 12");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('data-state="running"');
  });
  it("an unknown total is indeterminate", () => {
    const html = renderToString(<StatusRow tone="run" word="Running…" title="Docs" progress={{ done: 3, total: null }} />);
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("Running…");
  });
  it("carries the status name in data-state and no message on an ok row", () => {
    const html = renderToString(<StatusRow tone="warn" state="expired" word="Sign-in expired" title="Wiki" message="Sign in again" />);
    expect(html).toContain('data-state="expired"');
    expect(renderToString(<StatusRow tone="ok" word="Up to date" title="Docs" message="hidden" />)).not.toContain("hidden");
  });
  it("shows the owner's progress words and hides the spinner from screen readers", () => {
    const html = renderToString(<StatusRow tone="run" word="Running…" title="Docs" progress={{ done: 9, total: 24 }} progressText="Indexing 9 of 24 files" />);
    expect(html).toContain("Indexing 9 of 24 files");
    expect(html).toContain('aria-hidden="true"');
  });
  it("Return on the row opens it, but not Return inside one of its buttons", () => {
    const onOpen = vi.fn();
    const root = find(rendered(StatusRow, { tone: "ok", word: "Up to date", title: "Docs", onOpen }), (p) => p["data-component"] === "cpt-noter-component-ui-status-row");
    const key = (props: Record<string, unknown>, k: string, same: boolean) => {
      const e = { key: k, target: same ? "row" : "button", currentTarget: "row", preventDefault: vi.fn() };
      (props.onKeyDown as (e: unknown) => void)(e);
    };
    key(root.props, "Enter", true);
    key(root.props, "Enter", false);
    key(root.props, "a", true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(renderToString(<StatusRow tone="ok" word="Up to date" title="Docs" onOpen={onOpen} />)).toContain('tabindex="0"');
  });
});
