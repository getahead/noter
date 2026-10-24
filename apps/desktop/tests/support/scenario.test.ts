import { afterEach, expect, it } from "vitest";

import { ok } from "./results";
import { openScenario, type Scenario } from "./scenario";

let s: Scenario;
afterEach(async () => {
  await s.dispose();
});

it("the fake has no engine or native layer, and moves the Mac's free disk and output route", async () => {
  s = openScenario({ target: "fake" });
  expect(await s.engineFact({ type: "levels", call_id: null, mic_db: -30, sys_db: -30 })).toBe(false);
  expect(await s.engineKill()).toBe(false);
  expect(await s.surfaces()).toBeNull();
  await s.setFreeDisk(400);
  await s.setOutputRoute("headphones", null);
  const env = ok(await s.core("main").appSnapshot({})).environment;
  expect(env).toMatchObject({ disk_free_mb: 400, output_route: "headphones", output_device: null });
});
