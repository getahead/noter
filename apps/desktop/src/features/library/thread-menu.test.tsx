import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadToolbar } from "./TopicsToolbar";
import { setThreadMenu } from "./thread-menu";
import { setHead } from "./topics-head";

const base = { title: "Topic", subtitle: "", actions: [], hasSearch: false, narrow: false, canBack: true, canForward: false, showToggle: false, search: "", searchOpen: false, onBack: vi.fn(), onForward: vi.fn(), onToggleSidebar: vi.fn(), onSearch: vi.fn(), onRunSearch: vi.fn(), onOpenSearch: vi.fn(), onSearchBlur: vi.fn() };

describe("the thread's ⋯ menu (cpt-noter-flow-ui-library-search-topics-topic)", () => {
  it("shows More only while the thread published Rename… and Merge With…", () => {
    setHead({ title: "Drawer", subtitle: "3 calls" });
    const props: Record<string, unknown> = { route: { section: "library", key: "topic:t1" }, bridge: {} as never, base, inspectorOpen: false, onToggleInspector: vi.fn() };
    const tb = props as unknown as Parameters<typeof ThreadToolbar>[0];
    expect(renderToString(<ThreadToolbar {...tb} />)).not.toContain('aria-label="More"');
    setThreadMenu([{ label: "Rename…", onAction: vi.fn() }, { label: "Merge With…", onAction: vi.fn() }]);
    expect(renderToString(<ThreadToolbar {...tb} />)).toContain('aria-label="More"');
    setThreadMenu([]);
    setHead({ title: null, subtitle: null });
  });
});
