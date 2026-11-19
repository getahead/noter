import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnounceEvent } from "../../app/a11y/announce";
import { announceSearchResult, type Read } from "./SearchPage";

const frames = new Map<number, FrameRequestCallback>();
let next = 0;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
});
afterEach(() => {
  frames.clear();
  next = 0;
  vi.unstubAllGlobals();
});

const finishFrame = () => {
  for (const [id, callback] of frames) {
    frames.delete(id);
    callback(0);
  }
};
const results = (count: number, onlyWeak = false): Read => ({
  status: "OK",
  results: { calls: [], items: Array.from({ length: count }, () => ({})), documents: [], topics: [], only_weak: onlyWeak } as never,
});

describe("search count announcement (cpt-noter-algo-ui-library-search-topics-results)", () => {
  it("announces a final count once after the result commits, with a new event key for the same count", () => {
    const announce = vi.fn(async (_event: AnnounceEvent) => {});
    announceSearchResult(results(2), "words", announce);
    expect(announce).not.toHaveBeenCalled();
    finishFrame();
    expect(announce).toHaveBeenCalledOnce();
    expect(announce.mock.calls[0]![0]).toMatchObject({ kind: "search_done", text: "2 results" });
    announceSearchResult(results(2), "words", announce);
    finishFrame();
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce.mock.calls[1]![0].key).not.toBe(announce.mock.calls[0]![0].key);
  });

  it("names weak-only results and no matches using the query", () => {
    const announce = vi.fn(async () => {});
    announceSearchResult(results(1, true), "words", announce);
    finishFrame();
    expect(announce).toHaveBeenLastCalledWith(expect.objectContaining({ text: "1 result, only weak matches" }));
    announceSearchResult(results(0), "words", announce);
    finishFrame();
    expect(announce).toHaveBeenLastCalledWith(expect.objectContaining({ text: "No matches for “words”" }));
  });

  it("cancels a pending announcement when another read or route replaces it", () => {
    const announce = vi.fn(async () => {});
    const cancel = announceSearchResult(results(2), "old", announce);
    cancel!();
    finishFrame();
    expect(announce).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });

  it.each(["LOADING", "READ_ERROR"] as const)("does not announce a final count for %s", (status) => {
    const announce = vi.fn(async () => {});
    expect(announceSearchResult({ status }, "words", announce)).toBeUndefined();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });
});
