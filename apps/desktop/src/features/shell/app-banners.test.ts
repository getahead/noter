import { describe, expect, it, vi } from "vitest";

import { orderBanners } from "../../ui/feedback/banners";
import { appBanners, commandFailures, isBannerKind, type BannerActions } from "./app-banners";

const actions = (over: Partial<BannerActions> = {}): BannerActions => ({
  runSelfTest: vi.fn(),
  finishSetup: vi.fn(),
  restartNow: vi.fn(),
  openCall: vi.fn(),
  resumeRecording: vi.fn(),
  restart: { loading: false, tryAgain: false },
  retry: vi.fn(),
  ...over,
});
const setup = (type: string) => ({ self_test: { type } }) as never;
const banners = (...list: unknown[]) => ({ version: 1, banners: list }) as never;
const call = { id: "call_1", title: "Planning: VHI 8.0", started_at: 0, call_type: "x" };

describe("appBanners", () => {
  it("shows nothing for an empty set and a passed self-test (EMPTY)", () => {
    expect(appBanners({ banners: banners(), setup: setup("passed") }, actions())).toEqual([]);
    expect(appBanners({}, actions())).toEqual([]);
  });

  it("derives the self-test banner from a skipped or failed test, with its two actions", () => {
    const a = actions();
    for (const type of ["skipped", "failed"]) {
      const [b] = appBanners({ setup: setup(type) }, a);
      expect(b).toMatchObject({ id: "self-test", severity: "warning", text: "Call detection is off until the audio self-test passes" });
      expect(b!.actions!.map((x) => x.label)).toEqual(["Run Audio Self-Test…", "Finish Setup…"]);
      expect(b!.actions![1]!.link).toBe(true);
      expect(b!.dismissible).toBeUndefined();
    }
    const [b] = appBanners({ setup: setup("skipped") }, a);
    b!.actions![0]!.onAction!();
    b!.actions![1]!.onAction!();
    expect(a.runSelfTest).toHaveBeenCalledOnce();
    expect(a.finishSetup).toHaveBeenCalledOnce();
    for (const type of ["not_run", "running"]) expect(appBanners({ setup: setup(type) }, a)).toEqual([]);
  });

  it("maps the core's banners and runs their actions", () => {
    const a = actions();
    const list = appBanners({ banners: banners({ type: "recording_interrupted_by_quit", call }, { type: "update_ready", version: "1.2" }, { type: "roll_up_failed", at: 1 }) }, a);
    expect(list.map((b) => b.id)).toEqual(["recording_interrupted_by_quit", "update_ready", "roll_up_failed"]);
    expect(list[0]!.text).toBe("Noter quit during “Planning: VHI 8.0”");
    expect(list[0]!.dismissible).toBe(true);
    list[0]!.actions![0]!.onAction!();
    list[0]!.actions![1]!.onAction!();
    expect(a.openCall).toHaveBeenCalledWith("call_1");
    expect(a.resumeRecording).toHaveBeenCalledWith("call_1");
    expect(list[1]!.text).toBe("Version 1.2 installs on next launch");
    expect(list[1]!.actions![0]!.label).toBe("Restart Now");
    list[1]!.actions![0]!.onAction!();
    expect(a.restartNow).toHaveBeenCalledOnce();
  });

  it("keeps the update action with Try Again when update_install failed, and shows it working while it runs", () => {
    const update = banners({ type: "update_ready", version: "1.2" });
    expect(appBanners({ banners: update }, actions({ restart: { loading: false, tryAgain: true } }))[0]!.actions![0]!.label).toBe("Try Again");
    expect(appBanners({ banners: update }, actions({ restart: { loading: true, tryAgain: false } }))[0]!.actions![0]!.loading).toBe(true);
  });

  it("several waiting banners: the most severe shows with +2 More (ONE → SEVERAL → ONE)", () => {
    const all = appBanners({ banners: banners({ type: "update_ready", version: "1.2" }, { type: "roll_up_failed", at: 1 }), setup: setup("skipped") }, actions());
    const { first, more } = orderBanners(all);
    expect(first!.severity).toBe("warning");
    expect(more).toBe(2);
    expect(orderBanners(all.slice(0, 1)).more).toBe(0);
  });

  it("knows which ids are core banner kinds", () => {
    expect(["update_ready", "roll_up_failed", "recording_interrupted_by_quit"].every(isBannerKind)).toBe(true);
    expect(isBannerKind("self-test")).toBe(false);
  });

  it("shows a failed command as an error banner with Try Again only when the error is retryable, and the failure outranks the others", () => {
    const a = actions();
    const list = appBanners({ banners: banners({ type: "update_ready", version: "1.2" }) }, a, [{ key: "banner_dismiss", tryAgain: true }, { key: "window_navigate", tryAgain: false }]);
    const [retryable, final] = list.filter((b) => b.severity === "error");
    expect(retryable).toMatchObject({ id: "error:banner_dismiss", text: "Noter could not finish that action", dismissible: true });
    retryable!.actions![0]!.onAction!();
    expect(a.retry).toHaveBeenCalledWith("banner_dismiss");
    expect(final!.actions).toEqual([]);
    expect(orderBanners(list).first!.severity).toBe("error");
  });

  it("finds the failed commands of the frame, and ignores update_install and the commands that did not fail", () => {
    expect(
      commandFailures({
        window_navigate: { state: "ERROR", error: { tryAgain: true } },
        banner_dismiss: { state: "ERROR", error: null },
        window_show_call: { state: "WAITING", error: null },
        update_install: { state: "ERROR", error: { tryAgain: true } },
      }),
    ).toEqual([
      { key: "window_navigate", tryAgain: true },
      { key: "banner_dismiss", tryAgain: false },
    ]);
    expect(commandFailures({})).toEqual([]);
  });
});
