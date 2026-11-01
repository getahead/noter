"""Tests of the harness itself: a gate that is wrong is worse than no gate."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import arch_check  # noqa: E402
import ci_changes  # noqa: E402
import common  # noqa: E402
import config_guard  # noqa: E402
import coverage_gate  # noqa: E402
import e2e_coverage  # noqa: E402
import lane_guard  # noqa: E402
import perf_gate  # noqa: E402
import review  # noqa: E402
import stop_gate  # noqa: E402
import trace_gate  # noqa: E402

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
        sides = {"rust": {"a.rs": coverage_gate.FileCov({i: int(i < 7) for i in range(10)})}, "ui": {}}
        errors, report = coverage_gate.evaluate(sides, CFG, None)
        self.assertEqual(len(errors), 1)
        self.assertIn("70.00%", errors[0])
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

    def test_each_side_is_measured_and_enforced_where_harness_toml_sets_its_bar(self):
        m0 = self.milestones["M0"]
        everything, stories = set(m0["commands"]), set(m0["stories"])
        sides = {"backend": (everything, set()), "frontend": (everything, stories)}
        cfg = {**CFG, "milestone": {**CFG["milestone"], "current": "M0"}}
        errors, report = e2e_coverage.evaluate(common.ROOT, cfg, self.milestones, everything, stories, sides=sides)
        self.assertEqual(errors, [], "no per-side keys: reported only")
        self.assertIn("| backend: stories | 0 | 3 | 0.0% | reported |", report)
        strict = {**cfg, "gates": {**cfg["gates"], "e2e": {**cfg["gates"]["e2e"], "backend_stories_min": 60.0,
                                                            "frontend_stories_min": 60.0}}}
        errors, _ = e2e_coverage.evaluate(common.ROOT, strict, self.milestones, everything, stories, sides=sides)
        self.assertEqual(errors, ["E2E backend: stories coverage 0.0% < 60%"])
        self.assertEqual(e2e_coverage.side_of("conformance"), "backend")
        self.assertEqual({e2e_coverage.side_of(s) for s in ("ui-e2e", "ui-e2e-flows", "native")}, {"frontend"})

    def test_fake_core_runs_do_not_count(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "commands-a.json").write_text(json.dumps({"target": "fake", "commands": ["app_snapshot"], "stories": ["s1"]}))
            Path(d, "commands-b.json").write_text(json.dumps({"target": "stdio", "commands": ["log_ui"], "stories": ["s2"]}))
            pattern = str(Path(d, "commands-*.json"))
            self.assertEqual(e2e_coverage.invoked_commands([pattern]), {"log_ui"})
            self.assertEqual(e2e_coverage.read_logs([pattern]), ({"log_ui"}, {"s2"}))
            self.assertEqual(e2e_coverage.invoked_commands([pattern], include_fake=True), {"app_snapshot", "log_ui"})

    def test_main_logs_count_for_what_a_pull_request_did_not_re_run(self):
        with tempfile.TemporaryDirectory() as d:
            def log(name, **data):
                Path(d, f"commands-{name}.json").write_text(json.dumps(data))
            log("conformance", suite="conformance", target="stdio", commands=["log_ui"], stories=["s-conf"])
            log("flows", suite="ui-e2e-flows", target="stdio", commands=["a", "b"], stories=[], by_spec={
                "tests/e2e/x.spec.ts": {"commands": ["a"], "stories": []}, "tests/e2e/y.spec.ts": {"commands": ["b"], "stories": []}})
            log("ui-e2e", suite="ui-e2e", target="stdio", commands=[], stories=["sx", "sy"], by_spec={
                "tests/e2e/x.spec.ts": {"commands": [], "stories": ["sx"]}, "tests/e2e/y.spec.ts": {"commands": [], "stories": ["sy"]}})
            log("fake", suite="ui-e2e", target="fake", commands=["fake_only"], stories=["s-fake"], by_spec={})
            main = [str(Path(d, "commands-*.json"))]
            # x re-ran here: its fresh logs replace main's; y and the conformance suite come from main.
            self.assertEqual(e2e_coverage.baseline_logs(main, "tests/e2e/x.spec.ts", False), ({"log_ui", "b"}, {"s-conf", "sy"}))
            self.assertEqual(e2e_coverage.baseline_logs(main, "", True), ({"a", "b"}, {"sx", "sy"}))
            self.assertEqual(e2e_coverage.baseline_logs(main, "all", True), (set(), set()))
            log("old", suite="ui-e2e", target="stdio", commands=[], stories=["sz"])
            with self.assertRaises(common.HarnessError):
                e2e_coverage.baseline_logs(main, "tests/e2e/x.spec.ts", False)
            self.assertEqual(e2e_coverage.baseline_logs(main, "all", False), ({"log_ui"}, {"s-conf"}))

    def test_xcuitest_runs_count_like_real_core_runs(self):
        results = {"testNodes": [{"nodeType": "Test Plan", "name": "NoterNativeUITests", "result": "Failed", "children": [
            {"nodeType": "Unit test bundle", "name": "NoterNativeUITests", "children": [
                {"nodeType": "Test Suite", "name": "MenuBarTests", "children": [
                    {"nodeType": "Test Case", "name": "test_cpt_noter_seq_menu_bar_control_recording__pause_and_resume()",
                     "nodeIdentifier": "MenuBarTests/test_cpt_noter_seq_menu_bar_control_recording__pause_and_resume()",
                     "result": "Passed"},
                    {"nodeType": "Test Case", "name": "test_cpt_noter_seq_menu_bar_mute_copilot()", "result": "Failed"},
                    {"nodeType": "Test Case", "name": "test_cpt_noter_seq_menu_bar_check_state()", "result": "Skipped"},
                ]},
                {"nodeType": "Test Suite", "name": "NotificationTests", "children": [
                    {"nodeType": "Test Case", "name": "test_cpt_noter_seq_notifications_open_outputs()", "result": "Passed",
                     "children": [{"nodeType": "Repetition", "name": "cpt_noter_seq_not_a_story", "result": "Passed"}]},
                ]},
            ]},
        ]}]}
        with tempfile.TemporaryDirectory() as d:
            Path(d, "xcuitest-results.json").write_text(json.dumps(results))
            Path(d, "commands-native-app-42.json").write_text(json.dumps(
                {"suite": "native", "target": "app", "commands": ["capture_set_paused"], "stories": []}))
            stories = e2e_coverage.xcuitest_stories([str(Path(d, "xcuitest-*.json"))])
            self.assertEqual(stories, {"cpt-noter-seq-menu-bar-control-recording", "cpt-noter-seq-notifications-open-outputs"})
            self.assertEqual(e2e_coverage.read_logs([str(Path(d, "commands-*.json"))]), ({"capture_set_paused"}, set()))
        self.assertIn("coverage/native/commands-*.json", e2e_coverage.DEFAULT_COMMAND_LOGS)
        self.assertEqual(e2e_coverage.DEFAULT_XCUITEST_RESULTS, ["coverage/native/xcuitest-*.json"])
        self.assertEqual(e2e_coverage.xcuitest_stories([str(Path(d, "missing-*.json"))]), set())

    def test_story_ids_in_swift_test_names(self):
        self.assertEqual(e2e_coverage.story_ids("func test_cpt_noter_seq_today_tick_item__undo() {}"), {"cpt-noter-seq-today-tick-item"})
        self.assertEqual(e2e_coverage.story_ids('test("cpt-noter-seq-today-tick-item: tick")'), {"cpt-noter-seq-today-tick-item"})
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "apps", "desktop", "tests", "native", "NoterNativeUITests")
            p.mkdir(parents=True)
            (p / "MenuBarTests.swift").write_text("func test_cpt_noter_seq_menu_bar_check_state() {}")
            self.assertEqual(e2e_coverage.named_stories(Path(d), ["apps/desktop/tests/native"]), {"cpt-noter-seq-menu-bar-check-state"})

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

    def test_growth_allowance_raises_the_limit_for_that_scenario_only(self):
        base = {"mode": "ir", "results": {"s": {"status": "ok", "value": 100.0}, "t": {"status": "ok", "value": 100.0}}}
        head = {"mode": "ir", "results": {"s": {"status": "ok", "value": 112.0}, "t": {"status": "ok", "value": 112.0}}}
        errors, report = perf_gate.compare(base, head, 10.0, allowances={"s": 12.0})
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("t is 12.00% slower", errors[0])
        self.assertIn("≤ +22%", report)
        self.assertEqual(perf_gate.allowances({"scenarios": {"s": {"growth_allowance_pct": 12.0}, "t": {}}}), {"s": 12.0})

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
        self.assertEqual(run("sed -i 's/80.0/50.0/' harness/harness.toml", lane="ui"), 2)
        self.assertEqual(run("sed -i 's/a/b/' apps/desktop/src/x.ts", lane="ui"), 0)

    def test_ci_lane_check_lets_screenshots_through_to_the_label_gate(self):
        shot = "apps/desktop/tests/visual/__screenshots__/tokens.spec.ts/light.png"
        with mock.patch.dict("os.environ", {"GITHUB_HEAD_REF": "lane/ui/tokens", "NOTER_LANE": "", "NOTER_ALLOW_BASELINE": ""}):
            self.assertEqual(config_guard.lane_check([shot], CFG), [])
            self.assertEqual(len(config_guard.lane_check(["evals/golden/a.json"], CFG)), 1)
            self.assertEqual(len(config_guard.lane_check(["crates/noter-core/__screenshots__/a.png"], CFG)), 1)
        with mock.patch.dict("os.environ", {"GITHUB_HEAD_REF": "lane/skills/evals", "NOTER_LANE": "", "NOTER_ALLOW_BASELINE": ""}):
            self.assertEqual(len(config_guard.lane_check(["evals/golden/__screenshots__/a.json"], CFG)), 1)  # golden stays blocked
        self.assertIsNotNone(lane_guard.verdict(shot, "ui", CFG, committing=True))  # hand edits stay blocked

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
        looser["gates"]["unit"]["rust_min_lines"] = 70.0
        looser["gates"]["perf"]["max_regression_pct"] = 15.0
        looser["gates"]["visual"]["min_pixel_match"] = 95.0
        looser["coverage"]["exclude"].append({"path": "crates/noter-core/**", "why": "x"})
        found = config_guard.loosened(base, self._files(looser))
        self.assertEqual(len(found), 4, found)

    def test_perf_growth_allowance_is_loosening(self):
        base = self._files(CFG, perf={"scenarios": {"s": {"modes": ["ir"]}, "t": {"growth_allowance_pct": 5.0}}})
        same = self._files(CFG, perf={"scenarios": {"s": {"modes": ["ir"]}, "t": {"growth_allowance_pct": 5.0}}})
        self.assertEqual(config_guard.loosened(base, same), [])
        looser = self._files(CFG, perf={"scenarios": {"s": {"growth_allowance_pct": 12.0}, "t": {"growth_allowance_pct": 6.0}}})
        found = config_guard.loosened(base, looser)
        self.assertEqual(len(found), 2, found)
        tighter = self._files(CFG, perf={"scenarios": {"s": {"modes": ["ir"]}, "t": {}}})
        self.assertEqual(config_guard.loosened(base, tighter), [])

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

    def test_the_owners_bars_of_17_oct_2026(self):
        gates = CFG["gates"]
        self.assertEqual([gates["unit"][k] for k in ("rust_min_lines", "ui_min_lines", "changed_min_lines")], [80.0] * 3)
        self.assertEqual([gates["e2e"]["commands_min"], gates["e2e"]["stories_min"]], [60.0, 60.0])
        self.assertEqual(gates["visual"]["min_pixel_match"], 98.0)
        self.assertEqual([gates["perf"]["max_regression_pct"], gates["perf"]["scenario_coverage_min"]], [10.0, 60.0])
        self.assertTrue(gates["trace"]["ratchet"])
        self.assertLessEqual({"component", "interface", "seq", "dbtable", "flow", "algo", "state", "dod"}, set(gates["trace"]["kinds"]))

    def test_trace_gate_cannot_be_removed_turned_off_or_narrowed(self):
        base = self._files(CFG)

        def head(change):
            cfg = json.loads(json.dumps(CFG))
            change(cfg["gates"])
            return config_guard.loosened(base, self._files(cfg))

        self.assertEqual(head(lambda g: g.pop("trace")), ["gates.trace removed (trace-coverage gate)"])
        self.assertEqual(head(lambda g: g["trace"].update(ratchet=False)), ["gates.trace.ratchet turned off"])
        found = head(lambda g: g["trace"].update(kinds=[k for k in g["trace"]["kinds"] if k != "seq"]))
        self.assertEqual(len(found), 1, found)
        self.assertIn("seq", found[0])
        self.assertEqual(head(lambda g: g["trace"].update(kinds=g["trace"]["kinds"] + ["topology"])), [])
        without = json.loads(json.dumps(CFG))
        without["gates"].pop("trace")
        self.assertEqual(config_guard.loosened(self._files(without), self._files(CFG)), [])  # adding the gate


class TraceGateTests(unittest.TestCase):
    KINDS = ["component", "interface", "seq", "dbtable", "flow", "algo", "state", "dod"]
    REGISTRY = """[[systems]]
name = "Demo"
slug = "demo"
kit = "sdlc"
artifacts = [
  {{ path = "docs/DESIGN.md", kind = "DESIGN", traceability = "{mode}" }},
]
codebase = [{{ name = "code", path = "src", extensions = [".rs", ".ts"] }}]
children = []
"""
    DESIGN = (
        "# Design\n\n- [ ] `p1` - **ID**: `cpt-demo-component-a`\n\n- [ ] `p1` - **ID**: `cpt-demo-interface-b`\n\n"
        "- [ ] `p1` - **ID**: `cpt-demo-principle-x`\n\n```md\n**ID**: `cpt-demo-component-example`\n```\n"
    )

    def _repo(self, mode: str = "FULL") -> Path:
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self._git(root, "init", "-q")
        self._write(root, ".cf-studio/config/artifacts.toml", self.REGISTRY.format(mode=mode))
        self._write(root, "docs/DESIGN.md", self.DESIGN)
        self._write(root, "src/a.rs", "// @cpt-component:cpt-demo-component-a:p1\npub fn a() {}\n")
        self._write(root, "src/b.ts", "// @cpt-begin:cpt-demo-interface-b:p1:inst-x\nexport const b = 1;\n// @cpt-end:cpt-demo-interface-b:p1:inst-x\n")
        self._write(root, "src/node_modules/c.ts", "// @cpt-component:cpt-demo-component-c:p1\n")
        self._write(root, "src/notes.md", "@cpt-component:cpt-demo-component-c:p1\n")
        self._git(root, "add", "-A")
        self._git(root, "commit", "-q", "-m", "base")
        return root

    @staticmethod
    def _git(root: Path, *args: str) -> None:
        subprocess.run(["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", *args],
                       cwd=root, check=True, capture_output=True)

    @staticmethod
    def _write(root: Path, rel: str, text: str) -> None:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")

    def test_counts_traced_kinds_of_full_artifacts_and_markers_in_the_codebase(self):
        root = self._repo()
        self._write(root, "src/c.ts", "// @cpt-component:cpt-demo-component-c:p1\n")  # an ID the design does not define
        head = trace_gate.measure(trace_gate.WorkTree(root), self.KINDS)
        self.assertEqual(head.ids, {"cpt-demo-component-a": "component", "cpt-demo-interface-b": "interface"})
        self.assertEqual(head.covered, {"cpt-demo-component-a", "cpt-demo-interface-b"})
        self.assertEqual(head.value, 100.0)

    def test_docs_only_artifacts_are_not_traceable(self):
        head = trace_gate.measure(trace_gate.WorkTree(self._repo("DOCS-ONLY")), self.KINDS)
        self.assertEqual((head.ids, head.covered), ({}, set()))

    def test_base_is_read_from_git_without_a_checkout(self):
        root = self._repo()
        self._write(root, "src/a.rs", "pub fn a() {}\n")
        base = trace_gate.measure(trace_gate.GitRef(root, "HEAD"), self.KINDS)
        head = trace_gate.measure(trace_gate.WorkTree(root), self.KINDS)
        self.assertEqual(base.covered, {"cpt-demo-component-a", "cpt-demo-interface-b"})
        self.assertEqual(head.covered, {"cpt-demo-interface-b"})

    def test_a_covered_id_that_loses_its_marker_fails(self):
        root = self._repo()
        self._write(root, "src/a.rs", "pub fn a() {}\n")
        errors, report = trace_gate.run(root, "HEAD", self.KINDS, ratchet=True)
        self.assertEqual(len(errors), 2, errors)
        self.assertIn("cpt-demo-component-a", errors[0])
        self.assertIn("50.00%", report)

    def test_removing_an_implemented_design_id_with_its_marker_fails(self):
        root = self._repo()
        self._write(root, "docs/DESIGN.md", self.DESIGN.replace("**ID**: `cpt-demo-component-a`", "removed"))
        self._write(root, "src/a.rs", "pub fn a() {}\n")
        errors, _ = trace_gate.run(root, "HEAD", self.KINDS, ratchet=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("fell from 100.00% to 50.00%", errors[0])

    def test_new_design_ids_never_fail(self):
        root = self._repo()
        self._write(root, "docs/DESIGN.md", self.DESIGN + "\n- [ ] `p1` - **ID**: `cpt-demo-seq-new-story`\n")
        errors, report = trace_gate.run(root, "HEAD", self.KINDS, ratchet=True)
        self.assertEqual(errors, [])
        self.assertIn("| head | 2 | 3 | 66.67% |", report)
        self.assertIn("New IDs never fail this gate", report)

    def test_more_markers_pass(self):
        root = self._repo()
        self._write(root, "src/a.rs", "pub fn a() {}\n")
        self._git(root, "commit", "-q", "-am", "base without a")
        self._write(root, "src/a.rs", "// @cpt-component:cpt-demo-component-a:p1\npub fn a() {}\n")
        self.assertEqual(trace_gate.run(root, "HEAD", self.KINDS, ratchet=True)[0], [])

    def test_missing_base_or_ratchet_off_only_reports(self):
        root = self._repo()
        self._write(root, "src/a.rs", "pub fn a() {}\n")
        errors, report = trace_gate.run(root, "origin/does-not-exist", self.KINDS, ratchet=True)
        self.assertEqual(errors, [])
        self.assertIn("not found", report)
        errors, report = trace_gate.run(root, "HEAD", self.KINDS, ratchet=False)
        self.assertEqual(errors, [])
        self.assertIn("reported only", report)

    def test_this_repository_traces_its_contract_crate(self):
        head = trace_gate.measure(trace_gate.WorkTree(common.ROOT), CFG["gates"]["trace"]["kinds"])
        self.assertIn("cpt-noter-component-core-protocol", head.covered)
        self.assertIn("cpt-noter-interface-core-ipc", head.covered)


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


class DirectoryNamedLikeSourceTests(unittest.TestCase):
    """Playwright stores baselines in folders named after the spec file
    (`__screenshots__/x.spec.ts/`); the scanners must skip directories."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        shots = self.root / "apps/desktop/tests/visual/__screenshots__/a.spec.ts"
        shots.mkdir(parents=True)
        (shots / "x.png").write_bytes(b"")
        (self.root / "apps/desktop/tests/a.spec.ts").write_text("// cpt-noter-seq-demo\n", encoding="utf-8")
        (self.root / "apps/desktop/src/x").mkdir(parents=True)
        (self.root / "apps/desktop/src/x/dir.ts").mkdir()

    def test_opt_out_scan_skips_directories(self):
        self.assertEqual(arch_check.check_opt_outs(self.root), [])

    def test_ui_scan_skips_directories(self):
        self.assertEqual(arch_check.check_ui(self.root), [])

    def test_story_scan_skips_directories(self):
        self.assertEqual(e2e_coverage.named_stories(self.root, ["apps/desktop/tests"]), {"cpt-noter-seq-demo"})


REVIEW_MD = """# Code Review: PR #7

## Verdict: {icon} {verdict}

Rationale.

## Recommendation

1. **Minimum** (blocking) — must fix before merge
   - Handle the late result in `item_set_done`.
2. **Recommended** — should fix
   - Rename `x`.
"""
HEAD = "a" * 40
OLD = "b" * 40


def _pr(author="getahead", ref="feat/x"):
    return {"number": 7, "head": {"sha": HEAD, "ref": ref}, "user": {"login": author}}


def _comment(verdict, head=HEAD, assoc="OWNER", at="2026-10-18T10:00:00Z", body_verdict=None):
    md = REVIEW_MD.format(icon="✅", verdict=(body_verdict or verdict).replace("_", " "))
    return {"body": review.comment_body(md, head, verdict), "author_association": assoc, "updated_at": at,
            "html_url": "https://github.com/o/r/pull/7#issuecomment-1"}


class SelfReviewTests(unittest.TestCase):
    def test_parse_verdict(self):
        self.assertEqual(review.parse_verdict(REVIEW_MD.format(icon="✅", verdict="APPROVE")), "APPROVE")
        self.assertEqual(review.parse_verdict(REVIEW_MD.format(icon="⚠️", verdict="REQUEST CHANGES")), "REQUEST_CHANGES")
        self.assertEqual(review.parse_verdict("## Verdict: COMMENT"), "COMMENT")
        self.assertIsNone(review.parse_verdict("# no verdict here"))

    def test_missing_review_is_pending(self):
        self.assertEqual(review.evaluate(_pr(), []).state, "pending")

    def test_passing_verdict_on_head(self):
        for v in ("APPROVE", "COMMENT"):
            st = review.evaluate(_pr(), [_comment(v)])
            self.assertEqual(st.state, "success", v)
            self.assertTrue(st.target_url)

    def test_request_changes_fails(self):
        self.assertEqual(review.evaluate(_pr(), [_comment("REQUEST_CHANGES")]).state, "failure")

    def test_review_of_an_older_commit_does_not_count(self):
        self.assertEqual(review.evaluate(_pr(), [_comment("APPROVE", head=OLD)]).state, "pending")

    def test_comment_without_write_access_is_ignored(self):
        self.assertEqual(review.evaluate(_pr(), [_comment("APPROVE", assoc="NONE")]).state, "pending")
        self.assertEqual(review.evaluate(_pr(), [_comment("APPROVE", assoc="CONTRIBUTOR")]).state, "pending")

    def test_latest_review_wins(self):
        older, newer = _comment("APPROVE", at="2026-10-18T10:00:00Z"), _comment("REQUEST_CHANGES", at="2026-10-18T11:00:00Z")
        self.assertEqual(review.evaluate(_pr(), [newer, older]).state, "failure")
        older, newer = _comment("REQUEST_CHANGES", at="2026-10-18T10:00:00Z"), _comment("APPROVE", at="2026-10-18T11:00:00Z")
        self.assertEqual(review.evaluate(_pr(), [older, newer]).state, "success")

    def test_same_diff_on_a_new_head_keeps_the_review(self):
        diff = "diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"
        md = REVIEW_MD.format(icon="✅", verdict="APPROVE")
        c = {"body": review.comment_body(md, OLD, "APPROVE", diff), "author_association": "OWNER",
             "updated_at": "2026-10-18T10:00:00Z", "html_url": "u"}
        rebased = diff.replace("index 111..222", "index 333..444")
        self.assertEqual(review.evaluate(_pr(), [c], rebased).state, "success")
        changed = diff.replace("+b", "+c")
        self.assertEqual(review.evaluate(_pr(), [c], changed).state, "pending")
        self.assertEqual(review.evaluate(_pr(), [c]).state, "pending")

    def test_marker_without_fingerprint_still_parses(self):
        body = "<!-- noter-self-review head=" + HEAD + " verdict=APPROVE -->\n## Verdict: ✅ APPROVE"
        c = {"body": body, "author_association": "OWNER", "updated_at": "t", "html_url": "u"}
        self.assertEqual(review.evaluate(_pr(), [c], "any diff").state, "success")

    def test_head_marker_unchanged_for_older_evaluators(self):
        body = review.comment_body("## Verdict: ✅ APPROVE", HEAD, "APPROVE", "diff --git a/x b/x\n+a\n")
        old_style = re.compile(r"<!--\s*noter-self-review\s+head=([0-9a-f]{40})\s+verdict=(APPROVE|COMMENT|REQUEST_CHANGES)\s*-->")
        self.assertEqual(old_style.search(body).group(2), "APPROVE")
        self.assertTrue(review.DIFF_MARKER_RE.search(body))

    def test_unavailable_diff_falls_back_to_head_matching(self):
        with mock.patch.object(review, "_run", side_effect=review.Unavailable("too_large")), \
                mock.patch("sys.stderr", new=__import__("io").StringIO()):
            self.assertEqual(review._pr_diff("o/r", 7), "")
        self.assertEqual(review.evaluate(_pr(), [_comment("APPROVE")], "").state, "success")

    def test_marker_must_match_the_verdict_line(self):
        st = review.evaluate(_pr(), [_comment("APPROVE", body_verdict="REQUEST_CHANGES")])
        self.assertEqual(st.state, "failure")

    def test_bot_prs_pass(self):
        self.assertEqual(review.evaluate(_pr(author="dependabot[bot]"), []).state, "success")
        self.assertEqual(review.evaluate(_pr(author="github-actions[bot]", ref="release-please--branches--main"), []).state, "success")
        # A branch name proves nothing: an agent's release-please-- or dependabot/ branch still needs its review.
        self.assertEqual(review.evaluate(_pr(ref="release-please--branches--main"), []).state, "pending")
        self.assertEqual(review.evaluate(_pr(ref="dependabot/npm/x"), []).state, "pending")

    def test_blocking_findings(self):
        found = review.blocking_findings(REVIEW_MD.format(icon="⚠️", verdict="REQUEST CHANGES"))
        self.assertIn("late result", found)
        self.assertNotIn("Rename", found)

    def test_long_review_is_truncated(self):
        body = review.comment_body("## Verdict: ✅ APPROVE\n" + "x" * (review.COMMENT_LIMIT + 10), HEAD, "APPROVE")
        self.assertLess(len(body), review.COMMENT_LIMIT + 1000)
        self.assertTrue(review.MARKER_RE.search(body))

    def test_stop_hook_loops_on_review_and_gives_up(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(stop_gate, "state_dir", return_value=Path(d)):
            with mock.patch.object(review, "stop_check", return_value="review it"):
                codes = [stop_gate.review_loop() for _ in range(stop_gate.MAX_REVIEW_ROUNDS + 1)]
            self.assertEqual(codes[:-1], [2] * stop_gate.MAX_REVIEW_ROUNDS)
            self.assertEqual(codes[-1], 0)
            with mock.patch.object(review, "stop_check", return_value=None):
                self.assertEqual(stop_gate.review_loop(), 0)

    def test_auto_merge_refusal_only_warns(self):
        with mock.patch.object(review, "_run", side_effect=review.Unavailable("draft")), \
                mock.patch("sys.stderr", new=__import__("io").StringIO()) as err:
            self.assertFalse(review.enable_auto_merge(7))
        self.assertIn("gh pr merge 7 --auto --squash", err.getvalue())

    def test_plain_string_answers_are_not_parsed_as_json(self):
        with mock.patch.object(review, "_run", return_value="getahead/noter\n"), mock.patch.dict("os.environ", {"GITHUB_REPOSITORY": ""}):
            self.assertEqual(review._repo(), "getahead/noter")
        with mock.patch.object(review, "_run", return_value="not json"):
            with self.assertRaises(review.Unavailable):
                review._gh_json("api", "x")

    def test_stop_check_has_no_opinion_offline(self):
        with mock.patch.object(review, "_run", side_effect=review.Unavailable("offline")):
            self.assertIsNone(review.stop_check())


class CiChangesTests(unittest.TestCase):
    """Path filtering of the PR workflows: a skipped job must be one nothing changed for."""

    WORKFLOWS = {"ci": ("ci.yml", "gate"), "hygiene": ("pr.yml", "hygiene")}

    @staticmethod
    def _jobs_of(workflow: str) -> dict[str, str]:
        """Top-level job id -> its block of the workflow file."""
        text = (common.ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
        body = text.split("\njobs:\n", 1)[1]
        parts = re.split(r"(?m)^  ([a-z0-9-]+):\n", body)
        return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}

    def run_jobs(self, files, workflow="ci"):
        p = ci_changes.plan(files, CFG, workflow)
        return {j for j, run in p.jobs.items() if run}

    def test_rules_name_exactly_the_jobs_of_each_workflow(self):
        for key, (wf, aggregator) in self.WORKFLOWS.items():
            jobs = self._jobs_of(wf)
            self.assertEqual(set(CFG["ci"]["jobs"][key]), set(jobs) - {"changes", aggregator}, wf)
            needs = re.search(r"needs: \[([^\]]+)\]", jobs[aggregator]).group(1).split(", ")
            self.assertEqual(set(needs), set(jobs) - {aggregator}, f"{wf}: {aggregator} must wait for every job")
            for job in CFG["ci"]["jobs"][key]:
                areas = CFG["ci"]["jobs"][key][job]
                if areas != ["always"]:
                    self.assertIn(f"fromJSON(needs.changes.outputs.jobs)['{job}']", jobs[job], f"{wf}: {job} is not filtered")
        self.assertEqual(set(CFG["ci"]["jobs"]["codeql"]), {"actions", "javascript-typescript", "rust"})
        codeql = self._jobs_of("codeql.yml")["analyze"]
        self.assertIn("language: [actions, javascript-typescript, rust]", codeql,
                      "every language main has needs a result on every PR, analysed or carried forward")
        self.assertIn("github/codeql-action/upload-sarif@", codeql)

    def test_the_repository_layout_is_classified(self):
        # One file per kind the repository holds today; a file no rule knows runs everything (fail safe).
        known = [
            "README.md", "AGENTS.md", "CHANGELOG.md", ".gitignore", ".idea/.gitignore", ".claude/settings.json",
            ".githooks/pre-commit", ".plans/x.md", ".release-please-manifest.json", "release-please-config.json",
            "Cargo.toml", "Cargo.lock", "deny.toml", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
            ".github/dependabot.yml", ".github/CODEOWNERS", ".github/ISSUE_TEMPLATE/bug.yml", ".github/SECURITY.md",
            ".github/rulesets/default-branch.json", ".github/workflows/nightly.yml", ".github/zizmor.yml",
            ".cf-studio/config/artifacts.toml", "docs/diagrams/architecture.png", "scripts/dev/setup.sh",
            "crates/noter-core/src/lib.rs", "contracts/fixtures/world.json", "engine/Package.swift",
            "apps/desktop/index.html", "apps/desktop/src-tauri/tauri.conf.json", "apps/desktop/tests/visual/__screenshots__/a.png",
        ]
        unknown = [f for f in known if not common.matches_any(f, CFG["ci"]["everything"]) and ci_changes.classify(f, CFG["ci"])[0] is None]
        self.assertEqual(unknown, [])

    UI_ONLY = {"lint-ui", "arch", "unit-ui", "e2e-ui", "e2e-coverage", "visual", "docs"}
    BACKEND_ONLY = {"lint-rust", "arch", "unit-rust", "e2e-core", "e2e-coverage", "docs", "macos"}

    def test_frontend_only_change_runs_the_ui_side(self):
        # The real-core run is skipped; e2e-coverage judges main's real-core logs (ci.yml).
        self.assertEqual(self.run_jobs(["apps/desktop/src/App.tsx"]), self.UI_ONLY)

    def test_backend_only_change_runs_the_rust_side(self):
        # The fake world is TypeScript and never counted: a Rust change cannot change its runs or the pixels.
        self.assertEqual(self.run_jobs(["crates/noter-core/src/lib.rs"]), self.BACKEND_ONLY)

    def test_both_sides_run_both_halves(self):
        self.assertEqual(self.run_jobs(["crates/noter-core/src/lib.rs", "apps/desktop/src/App.tsx"]),
                         self.UI_ONLY | self.BACKEND_ONLY)

    def test_protocol_change_touches_both_sides(self):
        both = {"unit-rust", "unit-ui", "e2e-core", "e2e-ui", "e2e-coverage", "contract"}
        for f in ["crates/noter-protocol/src/lib.rs", "contracts/ipc.manifest.json", "apps/desktop/src/core/bindings.ts"]:
            self.assertLessEqual(both, self.run_jobs([f]), f)

    def test_screenshots_follow_the_ui_and_the_generated_contract(self):
        # noter-protocol reaches the pixels only through the regenerated contracts/** and bindings.ts.
        self.assertNotIn("visual", self.run_jobs(["crates/noter-protocol/src/lib.rs"]))
        self.assertNotIn("visual", self.run_jobs(["Cargo.lock"]))
        for f in ["contracts/fixtures/world.json", "apps/desktop/src/core/bindings.ts", "pnpm-lock.yaml"]:
            self.assertIn("visual", self.run_jobs([f]), f)

    def test_suites_that_run_against_the_real_core_run_both_halves(self):
        for f in ["apps/desktop/tests/e2e/m1-library-calls-ui.spec.ts", "apps/desktop/tests/conformance/a.test.ts",
                  "apps/desktop/tests/support/stdio-transport.ts", "apps/desktop/playwright.config.ts"]:
            self.assertLessEqual({"e2e-core", "e2e-ui", "e2e-coverage"}, self.run_jobs([f]), f)
        self.assertNotIn("e2e-core", self.run_jobs(["apps/desktop/tests/visual/primitives.spec.ts"]))

    def test_contract_runs_for_the_protocol_and_the_generated_files(self):
        for f in ["crates/noter-protocol/src/lib.rs", "contracts/ipc.manifest.json", "apps/desktop/src/core/bindings.ts"]:
            self.assertIn("contract", self.run_jobs([f]), f)
        self.assertNotIn("contract", self.run_jobs(["apps/desktop/src/App.tsx"]))

    def test_docs_change_runs_only_docs_and_trace(self):
        self.assertEqual(self.run_jobs(["docs/PRD.md"]), {"arch", "docs"})
        # Its stories set the bar; the suites and code are main's, so main's logs are judged again.
        self.assertEqual(self.run_jobs(["docs/DESIGN.md"]), {"arch", "docs", "e2e-coverage"})

    def test_tauri_host_is_not_ui(self):
        jobs = self.run_jobs(["apps/desktop/src-tauri/src/main.rs"])
        self.assertIn("macos", jobs)
        self.assertNotIn("visual", jobs)
        self.assertNotIn("lint-ui", jobs)

    def test_harness_and_unknown_files_run_everything(self):
        every = set(CFG["ci"]["jobs"]["ci"])
        for f in ["justfile", "harness/harness.toml", ".github/workflows/ci.yml", "skills/new/prompt.txt"]:
            self.assertEqual(self.run_jobs([f]), every, f)
            self.assertEqual(self.run_jobs([f], "hygiene"), set(CFG["ci"]["jobs"]["hygiene"]), f)

    def test_inert_files_run_nothing_but_the_always_checks(self):
        self.assertEqual(self.run_jobs([".github/dependabot.yml", ".plans/notes.txt"]), set())
        self.assertEqual(self.run_jobs([".github/dependabot.yml"], "hygiene"), {"title", "approvals"})
        self.assertEqual(self.run_jobs([".github/dependabot.yml"], "codeql"), set())

    def test_hygiene_checks_follow_their_files(self):
        self.assertEqual(self.run_jobs(["deny.toml"], "hygiene"), {"title", "approvals", "rust-deps"})
        self.assertEqual(self.run_jobs(["pnpm-lock.yaml"], "hygiene"), {"title", "approvals", "dependencies"})
        self.assertEqual(self.run_jobs([".github/workflows/nightly.yml"], "hygiene"),
                         {"title", "approvals", "dependencies", "workflows"})
        self.assertEqual(self.run_jobs([".github/workflows/nightly.yml"]), set(), "CI does not run for another workflow")

    def test_codeql_analyses_the_changed_languages(self):
        self.assertEqual(self.run_jobs(["apps/desktop/src/App.tsx"], "codeql"), {"javascript-typescript"})
        self.assertEqual(self.run_jobs(["engine/Sources/x.swift", "docs/PRD.md"], "codeql"), set())
        self.assertEqual(self.run_jobs([".github/workflows/nightly.yml"], "codeql"), {"actions"})

    def test_not_a_pull_request_runs_everything(self):
        p = ci_changes.plan(None, CFG, "ci", "a push run of main checks everything")
        self.assertTrue(all(p.jobs.values()))
        self.assertIn("push", p.summary())

    def test_unknown_area_in_a_rule_is_an_error(self):
        cfg = {"ci": {"areas": {"a": ["x/**"]}, "jobs": {"ci": {"j": ["b"]}}}}
        with self.assertRaises(common.HarnessError):
            ci_changes.plan([], cfg, "ci")

    def test_native_tests_tie_e2e_and_macos_together(self):
        native = ci_changes.Repo(engine=True, tauri=True, core_harness=True, native_tests=True)
        tied = ci_changes.apply_repo(ci_changes.plan(["apps/desktop/src/App.tsx"], CFG, "ci"), native)
        self.assertTrue(tied.jobs["macos"] and tied.jobs["e2e-coverage"])
        self.assertFalse(tied.jobs["e2e-core"], "the real-core run is still judged on main's logs")
        p = ci_changes.plan(["apps/desktop/src-tauri/src/main.rs"], CFG, "ci")
        tied = ci_changes.apply_repo(p, native)
        self.assertTrue(tied.jobs["e2e-coverage"])
        self.assertFalse(ci_changes.apply_repo(ci_changes.plan(["docs/PRD.md"], CFG, "ci"), native).jobs["macos"])
        loose = ci_changes.apply_repo(p, ci_changes.Repo(engine=False, tauri=False, core_harness=False, native_tests=False))
        self.assertFalse(loose.jobs["macos"], "nothing to build on macOS")

    def test_verdict_over_partial_runs(self):
        # A frontend-only plan: the skipped backend half passes, a backend half that ran and failed does not.
        p = ci_changes.plan(["apps/desktop/src/App.tsx"], CFG, "ci")
        ok, skipped = {"result": "success"}, {"result": "skipped"}
        needs = {"changes": ok, **{j: ok if run else skipped for j, run in p.jobs.items()}}
        self.assertEqual(ci_changes.verdict(needs, json.dumps(p.jobs)), [])
        self.assertEqual(ci_changes.verdict({**needs, "e2e-core": {"result": "failure"}}, json.dumps(p.jobs)),
                         ["e2e-core: failure"])
        self.assertEqual(ci_changes.verdict({**needs, "e2e-ui": skipped}, json.dumps(p.jobs)), ["e2e-ui: skipped"])

    def specs(self, files):
        return ci_changes.touched_specs(files, CFG["ci"])

    def test_a_pull_request_re_runs_the_flows_of_the_features_it_touches(self):
        self.assertEqual(self.specs(["crates/noter-core/src/tray.rs"]), "tests/e2e/m1-menu-bar.spec.ts")
        self.assertEqual(self.specs(["apps/desktop/src/features/settings/HotkeysPane.tsx"]),
                         "tests/e2e/m0-settings-hotkeys-ui.spec.ts tests/e2e/m0-settings-hotkeys.spec.ts "
                         "tests/e2e/m0-settings-window-ui.spec.ts")
        self.assertEqual(self.specs(["apps/desktop/tests/e2e/m1-floating-panel.spec.ts"]), "tests/e2e/m1-floating-panel.spec.ts")
        for f in ["docs/PRD.md", "apps/desktop/tests/visual/primitives.spec.ts", "apps/desktop/tests/conformance/m0-core.test.ts"]:
            self.assertEqual(self.specs([f]), "", f)

    def test_shared_code_re_runs_every_flow(self):
        for f in ["apps/desktop/src/core/bindings.ts", "apps/desktop/src/features/shell/MainWindow.tsx",
                  "crates/noter-core/src/app.rs", "crates/noter-db/src/lib.rs", "apps/desktop/tests/support/scenario.ts",
                  "apps/desktop/tests/e2e/support/fixtures.ts", "justfile"]:
            self.assertEqual(self.specs([f]), "all", f)
        self.assertEqual(self.specs(["crates/noter-core/src/tray.rs", "crates/noter-core/src/app.rs"]), "all")

    def test_without_main_logs_everything_runs_against_the_real_core(self):
        p = ci_changes.plan(["apps/desktop/src/features/library/CallsList.tsx"], CFG, "ci")
        q, specs, base = ci_changes.e2e_selection(p, CFG["ci"], "123")
        self.assertEqual((q.jobs["e2e-core"], specs.split()[0], base), (False, "tests/e2e/m1-library-calls-ui.spec.ts", "123"))
        q, specs, base = ci_changes.e2e_selection(p, CFG["ci"], "")
        self.assertEqual((q.jobs["e2e-core"], specs, base), (True, "all", ""))
        full = ci_changes.plan(None, CFG, "ci", "a push run of main checks everything")
        self.assertEqual(ci_changes.e2e_selection(full, CFG["ci"], "123")[1:], ("all", ""), "a full run needs no main logs")
        none = ci_changes.plan(["docs/PRD.md"], CFG, "ci")
        self.assertEqual(ci_changes.e2e_selection(none, CFG["ci"], "123")[1:], ("", ""))
        design = ci_changes.plan(["docs/DESIGN.md"], CFG, "ci")
        self.assertEqual(ci_changes.e2e_selection(design, CFG["ci"], "123")[1:], ("", "123"), "judged on main's logs")

    def test_verdict(self):
        ok, skipped, failed = {"result": "success"}, {"result": "skipped"}, {"result": "failure"}
        expected = json.dumps({"a": True, "b": False})
        self.assertEqual(ci_changes.verdict({"changes": ok, "a": ok, "b": skipped}, expected), [])
        self.assertEqual(ci_changes.verdict({"changes": ok, "a": ok, "b": ok}, expected), [])
        self.assertEqual(ci_changes.verdict({"changes": ok, "a": skipped, "b": skipped}, expected), ["a: skipped"])
        self.assertEqual(ci_changes.verdict({"changes": ok, "a": ok, "b": failed}, expected), ["b: failure"])
        self.assertTrue(ci_changes.verdict({"changes": failed, "a": skipped, "b": skipped}, ""))
        self.assertTrue(ci_changes.verdict({"changes": ok, "a": ok, "b": skipped, "c": ok}, expected), "unlisted job")
        self.assertTrue(ci_changes.verdict({"changes": ok, "a": ok, "b": skipped}, "not json"))

    def test_changed_files_from_git(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root, True)

        def g(*args):
            return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=root,
                                  capture_output=True, text=True, check=True).stdout.strip()
        g("init", "-q", "-b", "main")
        (root / "a.txt").write_text("a")
        g("add", "-A"); g("commit", "-qm", "base")
        g("checkout", "-qb", "topic")
        (root / "b.rs").write_text("b")
        g("add", "-A"); g("commit", "-qm", "topic")
        g("checkout", "-q", "main")
        (root / "c.md").write_text("c")
        g("add", "-A"); g("commit", "-qm", "main moves on")
        g("update-ref", "refs/remotes/origin/main", "main")
        g("checkout", "-q", "topic")
        files, why = ci_changes.changed_files("workflow_dispatch", "topic", "origin/main", root)
        self.assertEqual((files, why), (["b.rs"], ""))
        files, why = ci_changes.changed_files("pull_request", "1/merge", "origin/main", root)
        self.assertIsNone(files)
        self.assertIn("merge commit", why)
        g("checkout", "-q", "--detach", "main")
        g("merge", "-q", "--no-ff", "-m", "merge", "topic")
        files, _ = ci_changes.changed_files("pull_request", "1/merge", "origin/main", root)
        self.assertEqual(files, ["b.rs"], "the merge commit against main as merged, not main's own changes")
        self.assertIsNone(ci_changes.changed_files("push", "main", "origin/main", root)[0])
        self.assertIsNone(ci_changes.changed_files("workflow_dispatch", "main", "origin/main", root)[0])
