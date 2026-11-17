import { renderToString } from "react-dom/server";
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
});
