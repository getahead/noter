#!/usr/bin/env python3
"""Build/inspect/test locally; runtime requires an explicit disposable-session attestation."""
import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import signal
import socket
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
DENIALS = {errno.EPERM, errno.EACCES}


def command(arguments, **kwargs):
    return subprocess.run(arguments, check=True, capture_output=True, **kwargs)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assess(result, mode, nonce, digest):
    if not isinstance(result, dict):
        return ["child report is not an object"]
    failures = []
    for key, expected in (("nonce", nonce), ("mode", mode), ("sandbox_entitlement", True),
                          ("network_entitlement", False), ("inherit_entitlement", False)):
        if result.get(key) != expected:
            failures.append("mismatch: " + key)
    if mode == "implicit":
        if result.get("scope_started") is not True:
            failures.append("scope did not start")
        if result.get("fixture_sha256") != digest:
            failures.append("fixture hash mismatch")
    elif result.get("scope_started") is True:
        failures.append("negative control acquired a scope")
    for key in ("fixture_read", "workspace_write", "sibling_read", "sibling_write", "symlink_read", "loopback_connect"):
        observation = result.get(key)
        if not isinstance(observation, dict):
            failures.append("missing observation: " + key)
            continue
        expected_access = mode == "implicit" and key in ("fixture_read", "workspace_write")
        if expected_access:
            if observation.get("ok") is not True or observation.get("errno") != 0:
                failures.append("required access failed: " + key)
        elif observation.get("ok") is not False or observation.get("errno") not in DENIALS:
            failures.append("authorization denial not proved: " + key)
    return failures


def latest():
    result = json.loads((OUT / "latest.json").read_text())
    if not re.fullmatch(r"build-[a-f0-9]{32}", result["build_id"]):
        raise ValueError("invalid build identity")
    if set(result["source_sha256"]) != {"Sources/Shared.swift", "Sources/Host.swift", "Sources/Child.swift", "spike.py"}:
        raise ValueError("invalid source manifest")
    for relative, digest in result["source_sha256"].items():
        if sha(ROOT / relative) != digest:
            raise ValueError("source changed since build; build again: " + relative)
    return result


def bundle_paths(manifest):
    base = OUT / manifest["build_id"]
    host = base / "StorageAuthHost.app"
    child = host / "Contents/Helpers/StorageAuthChild.app"
    return host, child


def entitlements(app):
    return plistlib.loads(command(["codesign", "-d", "--entitlements", ":-", str(app)]).stdout)


def inspect():
    manifest = latest()
    host, child = bundle_paths(manifest)
    report = {"build_id": manifest["build_id"], "inspection_kind": "static; does not execute artifacts", "artifacts": {}}
    for app, name, identifier, expected in (
        (host, "StorageAuthHost", manifest["host_id"], {}),
        (child, "StorageAuthChild", manifest["child_id"], {"com.apple.security.app-sandbox": True}),
    ):
        command(["codesign", "--verify", "--deep", "--strict", str(app)])
        details = command(["codesign", "-d", "--verbose=4", str(app)]).stderr.decode()
        effective = entitlements(app)
        if effective != expected:
            raise ValueError("unexpected effective entitlements: " + name)
        if "Signature=adhoc" not in details or "runtime" not in details or "TeamIdentifier=not set" not in details:
            raise ValueError("not a teamless hardened ad-hoc artifact: " + name)
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        if info["CFBundleIdentifier"] != identifier or identifier.startswith(("com.getahead.noter", "ai.noter")):
            raise ValueError("invalid test identity")
        executable = app / "Contents/MacOS" / name
        if sha(executable) != manifest["binary_sha256"][name]:
            raise ValueError("artifact differs from built manifest: " + name)
        report["artifacts"][name] = {"bundle_id": identifier, "sha256": sha(executable),
            "entitlements": effective, "codesign": details, "executable": str(executable)}
    if report["artifacts"]["StorageAuthHost"]["bundle_id"] == report["artifacts"]["StorageAuthChild"]["bundle_id"]:
        raise ValueError("identities must differ")
    (OUT / manifest["build_id"] / "inspection.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def build():
    OUT.mkdir(exist_ok=True)
    build_id = "build-" + uuid.uuid4().hex
    base = OUT / build_id
    host_id = "org.getahead.storageauthspike.host." + build_id[6:]
    child_id = "org.getahead.storageauthspike.child." + build_id[6:]
    manifest = {"build_id": build_id, "host_id": host_id, "child_id": child_id}
    host, child = bundle_paths(manifest)
    for app, name, identifier, sandbox in ((child, "StorageAuthChild", child_id, True),
                                           (host, "StorageAuthHost", host_id, False)):
        binaries = app / "Contents/MacOS"
        binaries.mkdir(parents=True, exist_ok=True)
        info = {"CFBundleIdentifier": identifier, "CFBundleExecutable": name,
                "CFBundleName": name, "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
                "CFBundlePackageType": "APPL", "LSMinimumSystemVersion": "14.0"}
        if sandbox:
            info["LSUIElement"] = True
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        source = ROOT / "Sources" / ("Child.swift" if sandbox else "Host.swift")
        command(["xcrun", "swiftc", "-swift-version", "6", "-warnings-as-errors", "-O",
                 "-target", os.uname().machine + "-apple-macos14.0",
                 str(ROOT / "Sources/Shared.swift"), str(source), "-o", str(binaries / name)])
        entitlement_file = base / (name + ".entitlements")
        entitlement_file.write_bytes(plistlib.dumps({"com.apple.security.app-sandbox": True} if sandbox else {}))
        command(["codesign", "--force", "--sign", "-", "--options", "runtime", "--timestamp=none",
                 "--identifier", identifier, "--entitlements", str(entitlement_file), str(app)])
    manifest["source_sha256"] = {str(p.relative_to(ROOT)): sha(p) for p in
        sorted(list((ROOT / "Sources").glob("*.swift")) + [ROOT / "spike.py"])}
    manifest["binary_sha256"] = {name: sha(app / "Contents/MacOS" / name)
        for app, name in ((host, "StorageAuthHost"), (child, "StorageAuthChild"))}
    (OUT / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(inspect(), indent=2))


def tests():
    OUT.mkdir(exist_ok=True)
    result = command([sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "Tests"), "-p", "test_*.py"])
    print(result.stderr.decode(), end="")
    executable = OUT / "ProtocolTests"
    command(["xcrun", "swiftc", "-Onone", "-swift-version", "6", "-warnings-as-errors",
             str(ROOT / "Sources/Shared.swift"), str(ROOT / "Tests/ProtocolTests.swift"), "-o", str(executable)])
    print(command([str(executable)]).stdout.decode(), end="")


def owned_run(path):
    path = Path(path)
    home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
    expected_parent = home / "Library/Application Support/StorageAuthSpike"
    if path.is_symlink() or path.parent.resolve() != expected_parent or not re.fullmatch(r"[0-9a-f]{32}", path.name):
        raise ValueError("not an owned run directory")
    marker = json.loads((path / ".storage-auth-spike.json").read_text())
    if marker.get("kind") != "storage-auth-spike-v1" or marker.get("run_id") != path.name or marker.get("disposable_home") != str(home):
        raise ValueError("invalid ownership marker")
    return path


def runtime(args):
    if not args.disposable_session or not args.disposable_home or Path(args.disposable_home).resolve() != Path.home().resolve():
        raise ValueError("REFUSED: requires --disposable-session and --disposable-home matching this already disposable GUI user's HOME")
    # This is an explicit operator attestation, not a VM/user-isolation detector.
    if os.environ.get("CFFIXED_USER_HOME") or os.environ.get("APP_SANDBOX_CONTAINER_ID") or Path.home().resolve() != Path(pwd.getpwuid(os.getuid()).pw_dir).resolve():
        raise ValueError("home/sandbox overrides do not establish disposable isolation")
    running = command(["ps", "-axo", "comm="]).stdout.decode()
    if re.search(r"(?im)/(noter-desktop|noter-engine|xcodebuild|[^/]*UITests-Runner)(?:\s|$)", running):
        raise ValueError("Noter or native test activity present; do not launch")
    with open("/tmp/noter-issue-team-native.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        inspection = inspect()
        manifest = latest()
        host, _ = bundle_paths(manifest)
        run_id = uuid.uuid4().hex
        run = Path.home() / "Library/Application Support/StorageAuthSpike" / run_id
        run.mkdir(parents=True, mode=0o700)
        (run / ".storage-auth-spike.json").write_text(json.dumps({"kind": "storage-auth-spike-v1",
            "run_id": run_id, "build_id": manifest["build_id"], "disposable_home": str(Path.home().resolve())}))
        workspace = run / "workspace"
        for subdir in (workspace / "models", workspace / "audio", workspace / "engine-io", run / "denied"):
            subdir.mkdir(parents=True, mode=0o700)
        fixture = bytes(index % 251 for index in range(4096))
        (workspace / "models/probe.bin").write_bytes(fixture)
        sentinel = run / "denied/sentinel.bin"
        sentinel.write_bytes(b"synthetic denied sibling; never real user data\n")
        (workspace / "escape.bin").symlink_to(sentinel)
        for path in (workspace / "models/probe.bin", sentinel, run / ".storage-auth-spike.json"):
            path.chmod(0o600)
        digest = hashlib.sha256(fixture).hexdigest()
        print("Disposable fixture: " + str(run), flush=True)
        print("Select ONLY this folder when prompted: " + str(workspace), flush=True)
        mode = "implicit" if args.case == "cancel" else args.case
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(4)
            port = listener.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass
            with open(run / "host.stdout.jsonl", "wb") as stdout, open(run / "host.stderr.txt", "wb") as stderr:
                process = subprocess.Popen([str(host / "Contents/MacOS/StorageAuthHost"), "--disposable-session",
                    mode, str(run), str(port), str(args.launches), "cancel" if args.case == "cancel" else "run"],
                    stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True,
                    env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "LANG": "C"})
                try:
                    process.wait(timeout=120)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                    raise RuntimeError("120s deadline: owned process group stopped; inspect retained run " + str(run))
        output_file = run / "host.stdout.jsonl"
        if output_file.stat().st_size > 140_000:
            raise ValueError("oversized output; retained run " + str(run))
        observations = [json.loads(line) for line in output_file.read_text().splitlines()]
        failures = []
        if process.returncode != 0:
            failures.append("host nonzero exit")
        if args.case == "cancel":
            if observations != [{"status": "cancelled", "child_spawned": False}]:
                failures.append("cancellation did not stop before child spawn")
        elif len(observations) != args.launches:
            failures.append("wrong number of child observations")
        else:
            nonces = set()
            for observation in observations:
                nonce = observation.get("nonce", "")
                if not re.fullmatch(r"[0-9a-f]{32}", nonce) or nonce in nonces:
                    failures.append("missing/duplicate launch nonce")
                nonces.add(nonce)
                if observation.get("status") != "observed" or observation.get("child_exit") != 0:
                    failures.append("child did not complete")
                child = observation.get("child", {})
                failures.extend(assess(child, mode, nonce, digest))
                if child.get("bundle_id") != manifest["child_id"]:
                    failures.append("wrong child bundle identity")
                if observation.get("host_fixture_sha256") != digest:
                    failures.append("host positive file control failed")
                result_file = workspace / "audio" / (nonce + ".bin")
                if mode == "implicit" and (not result_file.is_file() or result_file.read_bytes() != nonce.encode()):
                    failures.append("child write not independently verified")
                if mode != "implicit" and result_file.exists():
                    failures.append("negative control wrote a file")
        if sha(workspace / "models/probe.bin") != digest:
            failures.append("fixture changed")
        if sentinel.read_bytes() != b"synthetic denied sibling; never real user data\n":
            failures.append("outside sentinel changed")
        result = {"case": args.case, "launches": args.launches, "failures": failures,
            "verdict": "PASS" if not failures else "FAIL", "run_dir": str(run),
            "os": command(["sw_vers"]).stdout.decode(), "inspection": inspection,
            "note": "Storage/sandbox evidence only; not Noter model/capture acceptance"}
        (run / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "inspect", "test"):
        sub.add_parser(name)
    run = sub.add_parser("run")
    run.add_argument("--disposable-session", action="store_true")
    run.add_argument("--disposable-home")
    run.add_argument("--case", choices=("none", "implicit", "stripped", "corrupt", "cancel"), required=True)
    run.add_argument("--launches", type=int, choices=(1, 2), default=1)
    cleanup = sub.add_parser("cleanup")
    cleanup.add_argument("--run-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "build":
        build()
    elif args.command == "inspect":
        print(json.dumps(inspect(), indent=2))
    elif args.command == "test":
        tests()
    elif args.command == "run":
        return runtime(args)
    else:
        import shutil
        path = owned_run(args.run_dir)
        shutil.rmtree(path)
        print("Removed owned synthetic run only; OS containers/permissions remain untouched: " + str(path))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        print(error.stderr.decode(errors="replace") if isinstance(error.stderr, bytes) else str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
