import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

const { listenNativeMenuAction, nativeAsk } = await import("./tauri-transport");

const alert = { title: "Delete “Backend sync”?", message: "Its audio and transcript are deleted.", kind: "warning" as const, okLabel: "Delete", cancelLabel: "Cancel" };

describe("listenNativeMenuAction", () => {
  it("does not subscribe when the window is running without the Tauri host", async () => {
    vi.mocked(listen).mockClear();

    const unlisten = await listenNativeMenuAction(vi.fn());

    expect(listen).not.toHaveBeenCalled();
    expect(unlisten).toBeTypeOf("function");
  });
});

describe("nativeAsk (cpt-noter-seq-dialogs-delete-call)", () => {
  beforeEach(() => invoke.mockReset());

  it("is the dialog plugin's two-button message with Cancel first, the button Return and Escape press", async () => {
    invoke.mockResolvedValue("Cancel");
    expect(await nativeAsk(alert)).toBe(false);
    expect(invoke).toHaveBeenCalledWith("plugin:dialog|message", {
      message: alert.message,
      title: alert.title,
      kind: "warning",
      buttons: { OkCancelCustom: ["Cancel", "Delete"] },
    });
  });

  it("is true only when the user chose the OK label", async () => {
    invoke.mockResolvedValue("Delete");
    expect(await nativeAsk(alert)).toBe(true);
  });
});
