"""Offline checks: failed requests and later redirects must never pass validation."""

import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import pin_manifest as manifest


class DownloadChecks(unittest.TestCase):
    allowed = {"huggingface.co", "cdn-lfs.huggingface.co"}
    url = "https://huggingface.co/model/resolve/commit/file"

    def check(self, *responses):
        opener = mock.Mock()
        opener.open.side_effect = responses
        with mock.patch.object(manifest.urllib.request, "build_opener", return_value=opener):
            result = manifest.redirect_host(self.url, self.allowed)
        return result, opener

    def redirect(self, location, code=302):
        return urllib.error.HTTPError(self.url, code, "redirect", {"Location": location}, io.BytesIO())

    def test_success_closes_response(self):
        response = mock.MagicMock()
        host, _ = self.check(response)
        self.assertEqual(host, "huggingface.co")
        response.__exit__.assert_called_once()

    def test_http_errors_are_failures(self):
        for status in (403, 404, 500):
            with self.subTest(status=status), self.assertRaises(ValueError):
                self.check(self.redirect("", status))

    def test_follows_relative_and_allowed_redirects(self):
        response = mock.MagicMock()
        host, opener = self.check(
            self.redirect("/next"),
            self.redirect("https://cdn-lfs.huggingface.co/file", 307),
            response,
        )
        self.assertEqual(host, "cdn-lfs.huggingface.co")
        self.assertEqual(opener.open.call_args_list[1].args[0].full_url, "https://huggingface.co/next")

    def test_later_disallowed_host_is_not_contacted(self):
        opener = mock.Mock()
        opener.open.side_effect = [self.redirect("/next"), self.redirect("https://evil.example/file")]
        with mock.patch.object(manifest.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(ValueError):
                manifest.redirect_host(self.url, self.allowed)
        self.assertEqual(opener.open.call_count, 2)

    def test_invalid_targets_and_missing_location_fail(self):
        for target in (
            "", "http://huggingface.co/file",
            "https://user:secret@huggingface.co/file", "https://huggingface.co:444/file",
        ):
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.check(self.redirect(target))

    def test_redirect_loop_is_bounded(self):
        with self.assertRaises(ValueError):
            self.check(*(self.redirect("/loop") for _ in range(11)))

    def test_small_files_are_checked_before_manifest_is_written(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "manifest.json"
            output.write_text("previous manifest")
            with (
                mock.patch.object(manifest, "OUT", output),
                mock.patch.object(manifest, "files_of", return_value=[{"url": self.url, "size_bytes": 10}]),
                mock.patch.object(manifest, "allowed_hosts", return_value=self.allowed),
                mock.patch.object(manifest, "redirect_host", side_effect=ValueError("HTTP 404")) as check,
            ):
                self.assertEqual(manifest.main(["--check"]), 2)
                check.assert_called_once_with(self.url, self.allowed)
            self.assertEqual(output.read_text(), "previous manifest")



class Files(unittest.TestCase):
    def test_a_repo_root_source_keeps_whole_paths_and_only_the_files_named(self):
        tree = [
            {"type": "file", "path": "model.safetensors", "size": 9, "lfs": {"oid": "big"}},
            {"type": "file", "path": "tokenizer.json", "size": 3},
            {"type": "directory", "path": "onnx"},
        ]
        spec = {"bundle": "b", "repo": "o/r", "commit": "c", "folder": "", "only": ["tokenizer.json"],
                "required_for_capture": True}
        with (
            mock.patch.object(manifest, "get_json", return_value=tree) as get,
            mock.patch.object(manifest, "sha256_of", return_value="small"),
        ):
            files = manifest.files_of(spec)
        get.assert_called_once_with(f"{manifest.API}/o/r/tree/c?recursive=true")
        self.assertEqual([(f["path"], f["sha256"]) for f in files], [("tokenizer.json", "small")])
        self.assertEqual(files[0]["url"], "https://huggingface.co/o/r/resolve/c/tokenizer.json")


if __name__ == "__main__":
    unittest.main()
