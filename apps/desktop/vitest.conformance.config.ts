// Conformance suite (docs/HARNESS.md › Conformance): the behaviour rules of the
// UI ↔ core contract (ADR-0002), run against the fake core today and against the
// real core through noter-core-harness from M0:
//
//   pnpm test:conformance                                   # fake core
//   NOTER_CORE=stdio NOTER_CORE_CMD="target/debug/noter-core-harness" pnpm test:conformance
//
// Every successful command is recorded into coverage/e2e/ for the E2E coverage gate.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/conformance/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/support/record-setup.ts"],
    testTimeout: 20_000,
    // One core process per worker when running against the real core.
    fileParallelism: process.env.NOTER_CORE !== "stdio",
  },
});
