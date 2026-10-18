// cpt-noter-dod-ui-primitives-text-only (PM-08): transcript, document, model and user text renders as
// plain text in every text-bearing primitive, so a hostile string never becomes markup.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Checkbox } from "./checkbox";
import { Disclosure } from "./disclosure";
import { IconButton } from "./icon-button";
import { KeyCap } from "./key-cap";
import { LevelMeter } from "./level-meter";
import { Link } from "./link";
import { PopupButton } from "./popup-button";
import { Progress } from "./progress";
import { PullDownButton } from "./pull-down-button";
import { PushButton } from "./push-button";
import { RadioGroup } from "./radio-group";
import { SearchField } from "./search-field";
import { SegmentTrack } from "./segmented-control";
import { Slider } from "./slider";
import { TextField } from "./text-field";
import { Toggle } from "./toggle";

const MARKUP = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
const LONG = "Sprint42retro".repeat(400);
const MIXED = "Анна said مرحبا to 田中 👋🏽 \u202Egnp.exe";

const renders: Record<string, (t: string) => ReactElement> = {
  "push-button": (t) => <PushButton label={t} ariaLabel={t} help={t} kbd={t} />,
  "icon-button": (t) => <IconButton icon="export" label={t} badge={t} />,
  "segmented-control": (t) => <SegmentTrack items={[{ value: "a", label: t }, t]} value="a" label={t} />,
  "popup-button": (t) => <PopupButton options={[t, { value: "b", label: t }]} value={t} label={t} />,
  "pull-down-button": (t) => <PullDownButton label={t} ariaLabel={t} />,
  checkbox: (t) => <Checkbox label={t} checked />,
  toggle: (t) => <Toggle label={t} on />,
  "radio-group": (t) => <RadioGroup name="r" options={[{ value: "a", label: t, note: t }]} value="a" label={t} />,
  "text-field": (t) => <TextField label={t} showLabel value={t} placeholder={t} invalid message={t} />,
  "text-field multi": (t) => <TextField variant="multi" value={t} label={t} />,
  "search-field": (t) => <SearchField value={t} placeholder={t} tokens={[{ label: t }]} />,
  slider: (t) => <Slider value={4} label={t} unit={t} valueText={t} />,
  progress: (t) => <Progress value={10} label={t} />,
  "level-meter": (t) => <LevelMeter level={3} label={t} />,
  badge: (t) => <Badge text={t} help={t} />,
  disclosure: (t) => <Disclosure label={t} open={false} />,
  link: (t) => <Link label={t} ariaLabel={t} />,
  "key-cap": (t) => <KeyCap keys={t} />,
};

describe("cpt-noter-dod-ui-primitives-text-only", () => {
  for (const [name, render] of Object.entries(renders)) {
    it(`${name} renders markup, very long lines and mixed scripts as text`, () => {
      const markup = renderToString(render(MARKUP));
      expect(markup).not.toMatch(/<img|<script/);
      expect(markup).toContain("&lt;img src=x onerror=");

      const long = renderToString(render(LONG));
      expect(long).toContain(LONG); // whole: never cut by the primitive itself

      expect(renderToString(render(MIXED))).toContain(MIXED);
    });
  }

  it("no primitive writes raw HTML", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    expect(sources.length).toBeGreaterThanOrEqual(17);
    for (const f of sources) expect(readFileSync(dir + f, "utf8"), f).not.toContain("dangerouslySetInnerHTML");
  });
});
