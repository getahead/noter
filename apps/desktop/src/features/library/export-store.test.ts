import { describe, expect, it, vi } from "vitest";
import { exportStore } from "./export-store";

describe("exportStore", () => {
  it("opens the export for the selected ids only, and nothing without a selection", () => {
    const open = vi.fn();
    exportStore.setOpener(open);
    exportStore.setIds([]);
    exportStore.run();
    expect(open).not.toHaveBeenCalled();
    const seen = vi.fn();
    const off = exportStore.subscribe(seen);
    exportStore.setIds(["a", "b"]);
    exportStore.setIds(["a", "b"]);
    expect(seen).toHaveBeenCalledTimes(1);
    exportStore.run();
    expect(open).toHaveBeenCalledWith(["a", "b"]);
    off();
    exportStore.setOpener(null);
    exportStore.setIds([]);
  });

  // #1053: a selection of calls still recording has nothing to export yet
  it("opens nothing for a selection of calls still recording, and says so", () => {
    const open = vi.fn();
    exportStore.setOpener(open);
    exportStore.setIds(["live"], true);
    expect(exportStore.isRecordingOnly()).toBe(true);
    exportStore.run();
    expect(open).not.toHaveBeenCalled();
    exportStore.setIds(["live", "past"], false);
    expect(exportStore.isRecordingOnly()).toBe(false);
    exportStore.run();
    expect(open).toHaveBeenCalledWith(["live", "past"]);
    exportStore.setOpener(null);
    exportStore.setIds([]);
  });
});
