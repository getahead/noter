import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("spike", ROOT / "spike.py")
spike = importlib.util.module_from_spec(spec)
spec.loader.exec_module(spike)


class ResultTests(unittest.TestCase):
    def report(self, mode="implicit"):
        return {
            "mode": mode, "nonce": "a" * 32, "sandbox_entitlement": True,
            "network_entitlement": False, "inherit_entitlement": False,
            "scope_started": mode == "implicit", "fixture_sha256": "b" * 64,
            "fixture_read": {"ok": mode == "implicit", "errno": 0 if mode == "implicit" else 1},
            "workspace_write": {"ok": mode == "implicit", "errno": 0 if mode == "implicit" else 1},
            "sibling_read": {"ok": False, "errno": 1},
            "sibling_write": {"ok": False, "errno": 1},
            "symlink_read": {"ok": False, "errno": 1},
            "loopback_connect": {"ok": False, "errno": 1},
        }

    def evaluate(self, result, mode="implicit"):
        return spike.assess(result, mode, "a" * 32, "b" * 64)

    def test_positive_requires_all_boundaries(self):
        self.assertEqual(self.evaluate(self.report()), [])
        for key in ("sibling_read", "sibling_write", "symlink_read", "loopback_connect"):
            with self.subTest(key=key):
                report = self.report()
                report[key] = {"ok": True, "errno": 0}
                self.assertTrue(self.evaluate(report))

    def test_refusal_is_not_network_or_file_authorization_denial(self):
        for key, code in (("loopback_connect", 61), ("sibling_read", 2), ("symlink_read", 40)):
            with self.subTest(key=key):
                report = self.report()
                report[key]["errno"] = code
                self.assertTrue(self.evaluate(report))

    def test_digest_and_nonce_are_required(self):
        for key in ("fixture_sha256", "nonce", "mode"):
            report = self.report()
            report[key] = "wrong"
            self.assertTrue(self.evaluate(report))

    def test_scope_and_signed_boundary_required(self):
        for key, value in (("scope_started", False), ("sandbox_entitlement", False),
                           ("network_entitlement", True), ("inherit_entitlement", True)):
            report = self.report()
            report[key] = value
            self.assertTrue(self.evaluate(report))

    def test_negative_cases_need_observed_denial(self):
        for mode in ("none", "stripped", "corrupt"):
            report = self.report(mode)
            self.assertEqual(self.evaluate(report, mode), [])
            report["fixture_read"] = {"ok": False, "errno": 2}
            self.assertTrue(self.evaluate(report, mode))

    def test_missing_evidence_fails(self):
        self.assertTrue(self.evaluate({}))
        self.assertTrue(self.evaluate(None))

    def test_cleanup_rejects_home_or_unmarked_paths(self):
        self.assertRaises(ValueError, spike.owned_run, Path.home())
        self.assertRaises(ValueError, spike.owned_run, ROOT)

    def test_driver_refuses_unattested_runtime_before_launch(self):
        result = subprocess.run([sys.executable, str(ROOT / "spike.py"), "run", "--case", "none"],
                                capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"REFUSED", result.stderr)

    def test_effective_artifact_entitlements(self):
        report = spike.inspect()
        self.assertEqual(report["artifacts"]["StorageAuthHost"]["entitlements"], {})
        self.assertEqual(report["artifacts"]["StorageAuthChild"]["entitlements"],
                         {"com.apple.security.app-sandbox": True})


if __name__ == "__main__":
    unittest.main()
