"""The pinned vendored runtime must bootstrap CI without a network download."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/ci/fetch-cf-studio.sh"
ARCHIVE = Path(".cf-studio/vendor/constructor-studio-v1.8.0.tar.gz")


class StudioFetchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / ".cf-studio").mkdir()
        shutil.copyfile(ROOT / ".cf-studio/version.toml", self.root / ".cf-studio/version.toml")
        (self.root / "bin").mkdir()
        curl = self.root / "bin/curl"
        curl.write_text("#!/bin/sh\necho unexpected-network-request >&2\nexit 97\n")
        curl.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.root / 'bin'}{os.pathsep}{os.environ['PATH']}")

    def fetch(self):
        return subprocess.run(
            ["bash", str(SCRIPT)], cwd=self.root, env=self.env,
            capture_output=True, text=True, timeout=30,
        )

    def copy_archive(self):
        target = self.root / ARCHIVE
        target.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / ARCHIVE, target)
        return target

    def test_pinned_archive_bootstraps_the_real_cli_offline(self):
        self.copy_archive()
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("unexpected-network-request", result.stderr)
        core = self.root / ".cf-studio/.core"
        self.assertTrue((core / "LICENSE").is_file())
        cli = subprocess.run(
            [sys.executable, str(core / "skills/studio/scripts/studio.py"), "--help"],
            cwd=self.root, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertIn("validate", cli.stdout)

    def test_corrupt_archive_fails_without_trying_the_network(self):
        self.copy_archive().write_bytes(b"not a tar archive")
        result = self.fetch()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("unexpected-network-request", result.stderr)

    def test_existing_runtime_is_preserved(self):
        cli = self.root / ".cf-studio/.core/skills/studio/scripts/studio.py"
        cli.parent.mkdir(parents=True)
        cli.write_text("existing runtime\n")
        self.copy_archive().write_bytes(b"not a tar archive")
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(cli.read_text(), "existing runtime\n")
        self.assertNotIn("unexpected-network-request", result.stderr)
