"""Tests of the harness itself: a gate that is wrong is worse than no gate."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import arch_check  # noqa: E402
import common  # noqa: E402
import config_guard  # noqa: E402
import coverage_gate  # noqa: E402
import e2e_coverage  # noqa: E402
import lane_guard  # noqa: E402
import perf_gate  # noqa: E402

CFG = common.harness_config()


class GlobTests(unittest.TestCase):
    def test_double_star_matches_any_depth(self):
        self.assertTrue(common.glob_match("contracts/skills/a.json", "contracts/**"))
        self.assertTrue(common.glob_match("a/b/__screenshots__/x.png", "**/__screenshots__/**"))
        self.assertTrue(common.glob_match("__screenshots__/x.png", "**/__screenshots__/**"))
        self.assertFalse(common.glob_match("contractsX/a", "contracts/**"))

    def test_single_star_stays_in_one_directory(self):
        self.assertTrue(common.glob_match("apps/desktop/vitest.unit.config.ts", "apps/desktop/vitest.*.ts"))
        self.assertFalse(common.glob_match("apps/desktop/x/vitest.a.ts", "apps/desktop/vitest.*.ts"))

    def test_dot_paths_and_prefixes(self):
        self.assertTrue(common.glob_match(".github/workflows/ci.yml", ".github/**"))
        self.assertTrue(common.glob_match("./justfile", "justfile"))
        self.assertTrue(common.glob_match("crates/x/y.rs", "crates/"))

    def test_pct_of_nothing_is_full(self):
        self.assertEqual(common.pct(0, 0), 100.0)
        self.assertEqual(common.pct(1, 4), 25.0)


class CoverageGateTests(unittest.TestCase):
    def _lcov(self, text: str) -> Path:
        f = tempfile.NamedTemporaryFile("w", suffix=".lcov", delete=False)
        f.write(text)
        f.close()
        return Path(f.name)

    def test_parse_merges_hits_and_prefixes_relative_paths(self):
        path = self._lcov("SF:src/a.ts\nDA:1,0\nDA:2,3\nend_of_record\nSF:src/a.ts\nDA:1,2\nend_of_record\n")
        files = coverage_gate.parse_lcov(path, "apps/desktop")
        self.assertEqual(files["apps/desktop/src/a.ts"].lines, {1: 2, 2: 3})

    def test_excluded_paths_do_not_count(self):
        files = {
            "crates/noter-protocol/src/fixtures.rs": coverage_gate.FileCov({1: 0, 2: 0}),
            "crates/noter-protocol/src/error.rs": coverage_gate.FileCov({1: 1}),
        }
        kept = coverage_gate.filtered(files, coverage_gate.exclusions(CFG))
        self.assertEqual(list(kept), ["crates/noter-protocol/src/error.rs"])

    def test_gate_fails_below_threshold_and_names_the_worst_files(self):
        sides = {"rust": {"a.rs": coverage_gate.FileCov({i: int(i < 8) for i in range(10)})}, "ui": {}}
        errors, report = coverage_gate.evaluate(sides, CFG, None)
        self.assertEqual(len(errors), 1)
        self.assertIn("80.00%", errors[0])
        self.assertIn("a.rs", errors[0])
        self.assertIn("ui unit | 0 | 0 | 100.00%", report)

    def test_changed_lines_must_be_covered(self):
        sides = {"rust": {"a.rs": coverage_gate.FileCov({1: 1, 2: 1, 3: 0, 4: 1})}}
        changed = {"a.rs": {3, 4, 99}, "other.rs": {1}}
        errors, report = coverage_gate.evaluate(sides, CFG, changed)
        self.assertTrue(any("changed-line coverage 50.00%" in e and "a.rs:3" in e for e in errors))

    def test_parse_diff_reads_added_ranges(self):
        diff = "+++ b/x.rs\n@@ -1,0 +5,3 @@\n+a\n@@ -9 +20 @@\n+b\n+++ /dev/null\n@@ -1 +0,0 @@\n"
        self.assertEqual(coverage_gate.parse_diff(diff), {"x.rs": {5, 6, 7, 20}})


class E2eCoverageTests(unittest.TestCase):
    def setUp(self):
        self.milestones = common.load_toml(common.ROOT / "harness" / "milestones.toml")

    def test_registry_places_every_command_and_story_once(self):
        cmds = set(e2e_coverage.manifest_commands(common.ROOT))
        stories = e2e_coverage.design_stories(common.ROOT)
        self.assertEqual(e2e_coverage.check_registry(self.milestones, cmds, stories), [])

    def test_registry_reports_duplicates_and_gaps(self):
        broken = {"M0": {"commands": ["a", "a"], "stories": []}}
        errors = e2e_coverage.check_registry(broken, {"a", "b"}, set())
        self.assertTrue(any("listed in M0 and M0" in e for e in errors))
        self.assertTrue(any("not placed" in e and "b" in e for e in errors))

    def test_gate_counts_only_delivered_frozen_commands(self):
        cfg = {**CFG, "milestone": {**CFG["milestone"], "current": "M0"}}
        m0 = self.milestones["M0"]
        frozen = [c for c in m0["commands"]]
        half = set(frozen[: len(frozen) // 2])
        errors, report = e2e_coverage.evaluate(common.ROOT, cfg, self.milestones, half, set(m0["stories"]))
        self.assertTrue(any("frozen commands" in e for e in errors))
        errors, _ = e2e_coverage.evaluate(common.ROOT, cfg, self.milestones, set(frozen), set(m0["stories"]))
        self.assertEqual(errors, [])

    def test_fake_core_runs_do_not_count(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "commands-a.json").write_text(json.dumps({"target": "fake", "commands": ["app_snapshot"], "stories": ["s1"]}))
            Path(d, "commands-b.json").write_text(json.dumps({"target": "stdio", "commands": ["log_ui"], "stories": ["s2"]}))
            pattern = str(Path(d, "commands-*.json"))
            self.assertEqual(e2e_coverage.invoked_commands([pattern]), {"log_ui"})
            self.assertEqual(e2e_coverage.read_logs([pattern]), ({"log_ui"}, {"s2"}))
            self.assertEqual(e2e_coverage.invoked_commands([pattern], include_fake=True), {"app_snapshot", "log_ui"})

    def test_story_ids_are_found_in_test_files(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "tests", "e2e")
            p.mkdir(parents=True)
            (p / "flow.spec.ts").write_text('test("cpt-noter-seq-today-tick-item: tick", () => {})')
            (p / "notes.md").write_text("cpt-noter-seq-ask-cited-answer")
            self.assertEqual(e2e_coverage.named_stories(Path(d), ["tests"]), {"cpt-noter-seq-today-tick-item"})


class PerfGateTests(unittest.TestCase):
    def test_instruction_regression_over_limit_fails(self):
        base = {"mode": "ir", "results": {"s": {"status": "ok", "value": 100.0}}}
        head = {"mode": "ir", "results": {"s": {"status": "ok", "value": 105.5}}}
        errors, _ = perf_gate.compare(base, head, 5.0)
        self.assertEqual(len(errors), 1)
        head["results"]["s"]["value"] = 104.9
        self.assertEqual(perf_gate.compare(base, head, 5.0)[0], [])

    def test_wall_regression_within_noise_passes(self):
        base = {"mode": "wall", "results": {"s": {"status": "ok", "value": 1.00, "mad": 0.05}}}
        head = {"mode": "wall", "results": {"s": {"status": "ok", "value": 1.08, "mad": 0.05}}}
        self.assertEqual(perf_gate.compare(base, head, 5.0)[0], [])
        head["results"]["s"]["value"] = 1.20
        self.assertEqual(len(perf_gate.compare(base, head, 5.0)[0]), 1)

    def test_report_only_never_fails_and_new_scenarios_pass(self):
        base = {"mode": "wall", "results": {}}
        head = {"mode": "wall", "results": {"s": {"status": "ok", "value": 9.0, "mad": 0.0}}}
        self.assertEqual(perf_gate.compare(base, head, 5.0)[0], [])
        base = {"mode": "wall", "results": {"s": {"status": "ok", "value": 1.0, "mad": 0.0}}}
        self.assertEqual(perf_gate.compare(base, head, 5.0, report_only=True)[0], [])

    def test_scenario_broken_on_base_fails_instead_of_counting_as_new(self):
        base = {"mode": "ir", "results": {"s": {"status": "failed", "why": "build error"}}}
        head = {"mode": "ir", "results": {"s": {"status": "ok", "value": 1.0}}}
        self.assertEqual(len(perf_gate.compare(base, head, 5.0)[0]), 1)

    def test_head_scenario_that_cannot_run_fails(self):
        head = {"mode": "ir", "results": {"s": {"status": "unavailable", "why": "build error"}}}
        self.assertEqual(len(perf_gate.compare({"results": {}}, head, 5.0)[0]), 1)

    def test_scenario_coverage_counts_due_entries(self):
        perf = {
            "registry": [
                {"id": "a", "milestone": "pre-M0", "scenario": "x"},
                {"id": "b", "milestone": "M0", "scenario": "y"},
                {"id": "c", "milestone": "M1", "scenario": "z"},
            ],
            "scenarios": {"x": {}},
        }
        cfg = {**CFG, "milestone": {**CFG["milestone"], "current": "M0"}}
        errors, report = perf_gate.coverage(cfg, perf)
        self.assertEqual(len(errors), 1)  # 1 of 2 due = 50%
        self.assertIn("b (M0", report)

    def test_registry_scenarios_exist_for_the_current_milestone(self):
        errors, _ = perf_gate.coverage(CFG, perf_gate.perf_config())
        self.assertEqual(errors, [])


class LaneGuardTests(unittest.TestCase):
    def test_generated_files_are_never_edited_but_may_be_committed(self):
        self.assertIsNotNone(lane_guard.verdict("contracts/ipc.manifest.json", None, CFG))
        self.assertIsNone(lane_guard.verdict("contracts/ipc.manifest.json", None, CFG, committing=True))

    def test_baselines_need_the_explicit_override(self):
        path = "apps/desktop/tests/visual/__screenshots__/a.png"
        self.assertIsNotNone(lane_guard.verdict(path, None, CFG))
        with mock.patch.dict("os.environ", {"NOTER_ALLOW_BASELINE": "1"}):
            self.assertIsNone(lane_guard.verdict(path, None, CFG))

    def test_lanes_keep_agents_inside_their_paths(self):
        self.assertIsNone(lane_guard.verdict("apps/desktop/src/screens/Today.tsx", "ui", CFG))
        self.assertIsNotNone(lane_guard.verdict("crates/noter-core/src/lib.rs", "ui", CFG))
        self.assertIsNotNone(lane_guard.verdict("apps/desktop/src/core/fake/handlers.ts", "ui", CFG))
        self.assertIsNone(lane_guard.verdict("apps/desktop/src/core/fake/handlers.ts", "contract", CFG))
        self.assertIsNotNone(lane_guard.verdict("crates/noter-protocol/src/lib.rs", "core", CFG))
        self.assertIsNone(lane_guard.verdict("docs/features/today.md", "core", CFG))
        self.assertIsNotNone(lane_guard.verdict("x", "nope", CFG))

    def test_agents_cannot_touch_the_harness(self):
        for path in ("harness/harness.toml", ".github/workflows/ci.yml", "justfile", "apps/desktop/vitest.unit.config.ts"):
            self.assertIsNotNone(lane_guard.verdict(path, "ui", CFG), path)
            self.assertIsNone(lane_guard.verdict(path, None, CFG), path)

    def test_hook_blocks_with_exit_code_2(self):
        payload = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(common.ROOT / "contracts/x.json")}})
        with mock.patch("sys.stdin", new=__import__("io").StringIO(payload)), mock.patch.dict("os.environ", {"NOTER_LANE": ""}):
            self.assertEqual(lane_guard.main(["hook"]), 2)
        payload = json.dumps({"tool_name": "Read", "tool_input": {"file_path": "contracts/x.json"}})
        with mock.patch("sys.stdin", new=__import__("io").StringIO(payload)):
            self.assertEqual(lane_guard.main(["hook"]), 0)

    def test_shell_writes_to_guarded_paths_are_blocked(self):
        def run(cmd, lane=""):
            payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}})
            with mock.patch("sys.stdin", new=__import__("io").StringIO(payload)), mock.patch.dict("os.environ", {"NOTER_LANE": lane}):
                return lane_guard.main(["hook"])
        self.assertEqual(run("sed -i 's/a/b/' apps/desktop/src/core/bindings.ts"), 2)
        self.assertEqual(run("echo x > contracts/ipc.manifest.json"), 2)
        self.assertEqual(run("cat contracts/ipc.manifest.json"), 0)
        self.assertEqual(run("just contract-regen"), 0)
        self.assertEqual(run("sed -i 's/90.0/50.0/' harness/harness.toml", lane="ui"), 2)
        self.assertEqual(run("sed -i 's/a/b/' apps/desktop/src/x.ts", lane="ui"), 0)

    def test_lane_from_branch_name(self):
        with mock.patch.dict("os.environ", {"NOTER_LANE": ""}), mock.patch("subprocess.run") as run:
            run.return_value.stdout = "lane/ui/today-screen\n"
            self.assertEqual(lane_guard.current_lane(), "ui")
            run.return_value.stdout = "main\n"
            self.assertIsNone(lane_guard.current_lane())


class ConfigGuardTests(unittest.TestCase):
    def _files(self, harness: dict, milestones: dict | None = None, perf: dict | None = None) -> dict:
        return {"harness/harness.toml": harness, "harness/milestones.toml": milestones or {}, "harness/perf.toml": perf or {}}

    def test_tightening_is_fine_loosening_is_reported(self):
        base = self._files(CFG)
        tighter = json.loads(json.dumps(CFG))
        tighter["gates"]["unit"]["rust_min_lines"] = 95.0
        tighter["gates"]["perf"]["max_regression_pct"] = 3.0
        self.assertEqual(config_guard.loosened(base, self._files(tighter)), [])
        looser = json.loads(json.dumps(CFG))
        looser["gates"]["unit"]["rust_min_lines"] = 80.0
        looser["gates"]["perf"]["max_regression_pct"] = 10.0
        looser["gates"]["visual"]["min_pixel_match"] = 95.0
        looser["coverage"]["exclude"].append({"path": "crates/noter-core/**", "why": "x"})
        found = config_guard.loosened(base, self._files(looser))
        self.assertEqual(len(found), 4, found)

    def test_moving_work_later_is_loosening(self):
        cfg = json.loads(json.dumps(CFG))
        cfg["milestone"]["current"] = "M1"
        base = self._files(cfg, {"M0": {"commands": ["a"], "stories": []}}, {"registry": [{"id": "p", "milestone": "M0"}]})
        later = json.loads(json.dumps(cfg))
        later["milestone"]["current"] = "M0"
        head = self._files(later, {"M1": {"commands": ["a"], "stories": []}}, {"registry": []})
        found = config_guard.loosened(base, head)
        self.assertEqual(len(found), 3, found)

    def test_new_harness_has_nothing_to_loosen(self):
        self.assertEqual(config_guard.loosened(self._files({}), self._files(CFG)), [])


class ArchCheckTests(unittest.TestCase):
    def _pkg(self, name: str, *deps: str) -> dict:
        return {"name": name, "dependencies": [{"name": d, "kind": None} for d in deps]}

    def test_principles_hold_for_allowed_owners(self):
        pkgs = [self._pkg("noter-db", "rusqlite"), self._pkg("noter-llm", "reqwest"), self._pkg("noter-desktop", "tauri"),
                self._pkg("noter-protocol", "serde", "specta")]
        self.assertEqual(arch_check.check_crates(pkgs), [])

    def test_violations_are_named(self):
        pkgs = [self._pkg("noter-core", "rusqlite", "reqwest", "tauri"), self._pkg("noter-protocol", "tokio")]
        rules = [v.rule for v in arch_check.check_crates(pkgs)]
        self.assertEqual(len(rules), 4)
        self.assertTrue(any("single writer" in r for r in rules))
        self.assertTrue(any("egress" in r for r in rules))

    def test_ui_imports_and_entitlements(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "apps/desktop/src/core").mkdir(parents=True)
            (root / "apps/desktop/src/screens").mkdir(parents=True)
            (root / "apps/desktop/src/core/tauri-transport.ts").write_text('import { invoke } from "@tauri-apps/api/core";')
            (root / "apps/desktop/src/screens/Today.tsx").write_text(
                'import { invoke } from "@tauri-apps/api/core";\nimport { FakeCore } from "../core/fake/fake-core";')
            (root / "engine").mkdir()
            (root / "engine/Engine.entitlements").write_text("<key>com.apple.security.network.client</key>")
            found = arch_check.check_ui(root) + arch_check.check_entitlements(root)
            self.assertEqual(len(found), 3)

    def test_gate_bypasses_are_caught(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "apps/desktop/tests").mkdir(parents=True)
            (root / "crates/x/tests").mkdir(parents=True)
            (root / "apps/desktop/tests/a.test.ts").write_text(
                "it.skip('x', () => {});\n/* v8 ignore next */\ndescribe.skipIf(!isFake)('ok', () => {});\nit.skipIf(true)('bad', () => {});\n")
            (root / "crates/x/tests/t.rs").write_text("#[test]\n#[ignore]\nfn slow() {}\n")
            found = arch_check.check_opt_outs(root)
            self.assertEqual(len(found), 4, [f.detail for f in found])

    def test_this_repository_passes(self):
        self.assertEqual(arch_check.run(), [])


if __name__ == "__main__":
    unittest.main()
