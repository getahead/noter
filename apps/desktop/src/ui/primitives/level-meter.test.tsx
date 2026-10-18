import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LevelMeter } from "./level-meter";

const segs = (html: string) => [...html.matchAll(/class="(np-meter__seg[^"]*)"/g)].map((m) => m[1]);

describe("level-meter", () => {
  it("is a meter of 10 segments, silent, signal or clipping", () => {
    const silent = renderToString(<LevelMeter />);
    expect(silent).toMatch(/^<span class="np-meter" data-component="cpt-noter-component-ui-primitives" data-primitive="level-meter" data-variant="horizontal" data-state="silent" role="meter" aria-label="Level" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">/);
    expect(segs(silent)).toEqual(Array(10).fill("np-meter__seg"));
    const signal = renderToString(<LevelMeter level={6} label="Microphone level" />);
    expect(signal).toContain('data-state="signal"');
    expect(signal).toContain('aria-valuenow="60"');
    expect(segs(signal).filter((c) => c.includes("is-on"))).toHaveLength(6);
    const clip = renderToString(<LevelMeter level={10} clipping />);
    expect(clip).toContain('data-state="clipping"');
    expect(segs(clip)[9]).toBe("np-meter__seg is-on is-clip");
  });
});
