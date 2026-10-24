import { describe, expect, it, vi } from "vitest";
import { askAlert, deleteAlert, quitAlert } from "./alerts";

describe("deleteAlert (cpt-noter-algo-ui-dialogs-host-delete-alert)", () => {
  it("asks about one call by its own title, Cancel first", () => {
    expect(deleteAlert([{ id: "c1", title: "Backend sync" }])).toEqual({
      title: "Delete “Backend sync”?",
      message: "This removes its audio, transcript, summary, items and cards. You can't undo this.",
      cancel: "Cancel",
      confirm: "Delete",
      destructive: true,
    });
  });

  it("keeps a title in another script inside the quotes", () => {
    expect(deleteAlert([{ id: "c1", title: "Планирование" }]).title).toBe("Delete “Планирование”?");
  });

  it("asks about several calls through the plural rules", () => {
    const a = deleteAlert([1, 2, 3].map((n) => ({ id: `c${n}`, title: `T${n}` })));
    expect(a.title).toBe("Delete 3 calls?");
    expect(a.confirm).toBe("Delete 3 Calls");
    expect(a.message).toBe("This removes their audio, transcripts, summaries, items and cards. You can't undo this.");
    expect(deleteAlert([1, 2].map((n) => ({ id: `c${n}`, title: "x" }))).confirm).toBe("Delete 2 Calls");
  });
});

describe("quitAlert (cpt-noter-flow-ui-dialogs-host-quit)", () => {
  it("names the recording and keeps Cancel as the safe button", () => {
    expect(quitAlert("Planning")).toEqual({
      title: "Noter is recording “Planning”",
      message: "Quitting stops the recording. The transcript so far is kept.",
      cancel: "Cancel",
      confirm: "Stop and Quit",
      destructive: false,
    });
  });
});

describe("askAlert (cpt-noter-flow-ui-dialogs-host-delete-call)", () => {
  const spec = deleteAlert([{ id: "c1", title: "A" }]);

  it("sends the dialog plugin's ask with the labels and a warning kind, and answers true on confirm", async () => {
    const ask = vi.fn().mockResolvedValue(true);
    expect(await askAlert(spec, ask)).toBe(true);
    expect(ask).toHaveBeenCalledWith({ title: spec.title, message: spec.message, kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
  });

  it("answers false on cancel and when the dialog cannot be shown", async () => {
    expect(await askAlert(spec, vi.fn().mockResolvedValue(false))).toBe(false);
    expect(await askAlert(spec, vi.fn().mockRejectedValue("denied"))).toBe(false);
  });

  it("is informational when the action is not destructive", async () => {
    const ask = vi.fn().mockResolvedValue(true);
    await askAlert(quitAlert("A"), ask);
    expect(ask.mock.calls[0][0].kind).toBe("info");
  });
});
