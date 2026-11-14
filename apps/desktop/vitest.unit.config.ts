// Unit tests (docs/HARNESS.md › Unit). Coverage is written as LCOV and judged by
// scripts/harness/coverage_gate.py, which applies the exclusions listed (with
// reasons) in harness/harness.toml — keep exclusions there, not here.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/support/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["lcov", "text-summary"],
      reportsDirectory: "coverage/unit",
    },
  },
});
