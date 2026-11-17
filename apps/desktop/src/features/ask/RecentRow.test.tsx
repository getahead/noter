import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentRow } from "./RecentRow";

describe("RecentRow (cpt-noter-dod-ui-ask-threads)", () => {
  it("shows the question as a button, marked when it is the open one, with no menu until asked", () => {
    const row = { id: "a", title: "What did Ann say?", updated_at: 0 } as never;
    const h = renderToString(<RecentRow row={row} selected onOpen={() => {}} onCopy={() => {}} onDelete={() => {}} />);
    expect(h).toContain("What did Ann say?");
    expect(h).toContain('aria-current="true"');
    expect(h).not.toContain("Delete");
  });
});
