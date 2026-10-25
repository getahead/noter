import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CallRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import type { CallsState } from "./calls-list";
import { CallsView, ContextMenu, type CallsViewProps } from "./calls-view";
import { NONE } from "./selection";

const call = (id: string, o: Partial<CallRow> = {}) =>
  ({
    id,
    rev: 1,
    title: `Call ${id}`,
    call_type: "one_on_one",
    started_at: Date.UTC(2026, 9, 2, 12),
    duration_ms: 3_600_000,
    participants: [],
    unnamed_speakers: 0,
    languages: ["en"],
    tags: [],
    privacy: "normal",
    status: "ready",
    outputs: "ready",
    archive: "done",
    audio_kept_until: null,
    audio_deleted: false,
    open_items: 0,
    review_waiting: 0,
    ...o,
  }) as CallRow;
const state = (o: Partial<CallsState> = {}): CallsState => ({
  status: "LISTED",
  rows: [call("a"), call("b")],
  sort: "newest",
  total: 2,
  next: null,
  error: null,
  ...o,
});
const props = (o: Partial<CallsViewProps> = {}): CallsViewProps => ({
  state: state(),
  selection: NONE,
  slow: false,
  failed: null,
  selfTestPassed: true,
  menu: null,
  onSort: vi.fn(),
  onPress: vi.fn(),
  onOpen: vi.fn(),
  onContext: vi.fn(),
  onKeyDown: vi.fn(),
  onRetry: vi.fn(),
  onSelfTest: vi.fn(),
  onDismissFailed: vi.fn(),
  onCloseMenu: vi.fn(),
  onDelete: vi.fn(),
  ...o,
});
const html = (o: Partial<CallsViewProps>) =>
  renderToString(<CallsView {...props(o)} />);

describe("CallsView (cpt-noter-dod-ui-library-calls-table)", () => {
  it("renders LC-R1 with the counts and the table with a month header and the sorted column", () => {
    const h = html({});
    expect(h).toContain('data-region="LC-R1"');
    expect(h).toContain("2 calls · 2 hours · since 2 Oct");
    expect(h).toContain("October 2026");
    expect(h).toContain('aria-sort="descending"');
    expect(h).toContain("Call a");
    expect(h).toContain('data-variant="table-row"');
  });

  it("states the page's state on the table region, SELECTED_SEVERAL once more than one row is selected", () => {
    expect(html({})).toContain('data-region="LC-R3" data-state="listed"');
    expect(html({ selection: { ids: ["a"], anchor: "a" } })).toContain('data-state="listed"');
    expect(html({ selection: { ids: ["a", "b"], anchor: "a" } })).toContain('data-state="selected-several"');
  });

  it("keeps the status text in the row for the Medium width, which hides it visually", () => {
    const h = html({ state: state({ rows: [call("a", { outputs: "writing" })] }) });
    expect(h).toContain('<span class="lb-status__text">Writing summary…</span>');
  });

  it("adds the selection count to the subtitle and marks the rows", () => {
    const h = html({ selection: { ids: ["a", "b"], anchor: "a" } });
    expect(h).toContain("· 2 selected");
    expect(h).toContain('aria-selected="true"');
  });

  it("shows No calls yet, with the self-test action only while it has not passed", () => {
    const empty = state({ status: "EMPTY", rows: [] });
    expect(html({ state: empty, selfTestPassed: false })).toContain(
      "Run Audio Self-Test…",
    );
    expect(html({ state: empty })).not.toContain("Run Audio Self-Test…");
    expect(html({ state: empty })).toContain("No calls yet");
  });

  it("shows skeleton rows only once the read is slow, and the error banner with Try Again", () => {
    const loading = state({ status: "LOADING", rows: [] });
    expect(html({ state: loading })).not.toContain("lb-skel__row");
    expect(html({ state: loading, slow: true })).toContain('aria-busy="true"');
    expect(html({ state: state({ status: "ERROR", rows: [] }) })).toContain(
      "Try Again",
    );
  });

  it("shows a failed delete as a banner", () => {
    expect(html({ failed: "Couldn’t delete the calls" })).toContain(
      "Couldn’t delete the calls",
    );
  });

  it("makes the sortable headers keyboard stops and leaves Type and Open as plain headers", () => {
    const h = html({});
    expect(h.match(/<th scope="col"[^>]*tabindex="0"/g)).toHaveLength(3);
  });
});

describe("ContextMenu", () => {
  it("offers Open for one call and Delete… with its shortcut, and runs them after closing", () => {
    const [onClose, onOpen, onDelete] = [vi.fn(), vi.fn(), vi.fn()];
    const tree = rendered(ContextMenu, {
      onClose,
      single: call("a"),
      onOpen,
      onDelete,
    });
    const items = (
      find(tree, (p) => Array.isArray(p.items)).props.items as {
        label?: string;
        onSelect?: () => void;
        disabled?: boolean;
      }[]
    ).filter((i) => i.label);
    expect(items.map((i) => i.label)).toEqual(["Open", "Delete…"]);
    items[0]!.onSelect!();
    items[1]!.onSelect!();
    expect(onOpen).toHaveBeenCalledWith("a");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("disables Open when several calls are selected", () => {
    const tree = rendered(ContextMenu, {
      onClose: vi.fn(),
      single: null,
      onOpen: vi.fn(),
      onDelete: vi.fn(),
    });
    expect(
      (
        find(tree, (p) => Array.isArray(p.items)).props.items as {
          label?: string;
          disabled?: boolean;
        }[]
      )[0]!.disabled,
    ).toBe(true);
  });
});
