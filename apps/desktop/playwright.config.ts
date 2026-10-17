// Screenshot and UI end-to-end tests (docs/HARNESS.md › Visual, › End to end).
//
// Screenshots are compared per pixel against baselines rendered in the pinned
// Playwright container (WebKit on Linux): at most 2% of pixels may differ
// (harness.toml gates.visual). Baselines live next to the specs in
// __screenshots__/ and change only through `just visual-update` or the
// `update-screenshots` workflow, reviewed by the owner.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The bars come from harness/harness.toml [gates.visual] (the config guard watches that file).
const harness = readFileSync(fileURLToPath(new URL("../../harness/harness.toml", import.meta.url)), "utf8");
const minPixelMatch = Number(/min_pixel_match\s*=\s*([\d.]+)/.exec(harness)?.[1]);
const colorThreshold = Number(/pixel_color_threshold\s*=\s*([\d.]+)/.exec(harness)?.[1]);
if (!(minPixelMatch > 0) || !(colorThreshold >= 0)) throw new Error("harness.toml [gates.visual] is missing or unreadable");
const hasApp = existsSync(fileURLToPath(new URL("./index.html", import.meta.url)));

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  // In CI a missing baseline is a failure, never silently written.
  updateSnapshots: process.env.CI ? "none" : "missing",
  retries: 0,
  reporter: [
    ["list"],
    ["./tests/support/story-reporter.ts"],
    ...(process.env.CI ? [["html", { open: "never", outputFolder: "playwright-report" }] as const] : []),
  ],
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: (100 - minPixelMatch) / 100,
      threshold: colorThreshold,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    ...devices["Desktop Safari"],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "visual", testDir: "tests/visual" },
    { name: "e2e", testDir: "tests/e2e" },
  ],
  // The UI scaffold (Vite) is not in the repo yet; once index.html exists the
  // suites run against the dev server with the fake core, or the real core
  // through the harness bridge when NOTER_CORE=stdio (docs/HARNESS.md).
  webServer: hasApp
    ? { command: "pnpm exec vite --port 5173 --strictPort", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, env: { VITE_FAKE_CORE: process.env.NOTER_CORE === "stdio" ? "" : "1" } }
    : undefined,
});
