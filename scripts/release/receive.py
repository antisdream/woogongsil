#!/usr/bin/env python3
"""Install once as root-owned code; run via a restricted, dedicated SSH key."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path, PurePosixPath

BASE = Path("/home/ubuntu/wgs_deploy/github-releases")
LIMIT = 200 * 1024 * 1024
EXPANDED_LIMIT = 600 * 1024 * 1024


def validate_members(members):
    names = set()
    size = 0
    for item in members:
        name = item.name
        path = PurePosixPath(name)
        if (not item.isfile() or path.is_absolute() or ".." in path.parts or "\\" in name
                or str(path) != name or name in names):
            raise ValueError("Unsafe archive entry")
        if name != "release-manifest.json" and not name.startswith(("app/", "scripts/release/")):
            raise ValueError("Unexpected archive entry")
        if any(p.startswith(".") or p in {"node_modules", "uploads"} for p in path.parts):
            raise ValueError("Protected archive entry")
        names.add(name)
        size += item.size
        if size > EXPANDED_LIMIT or len(names) > 10000:
            raise ValueError("Archive too large")
    if "release-manifest.json" not in names or "scripts/release/deploy.py" not in names:
        raise ValueError("Incomplete release")


def receive():
    import fcntl
    os.umask(0o077)
    command = os.environ.get("SSH_ORIGINAL_COMMAND", "")
    match = re.fullmatch(r"deploy (v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) ([a-f0-9]{40}) ([a-f0-9]{64})", command)
    if not match:
        raise ValueError("Only a validated release deployment is allowed")
    tag, commit, expected = match.groups()
    BASE.mkdir(mode=0o700, exist_ok=True)
    if BASE.is_symlink() or BASE.resolve() != BASE:
        raise ValueError("Invalid release directory")
    with (BASE / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        incoming = BASE / (tag + "-" + commit[:12] + ".incoming.tar.gz")
        total = 0
        checksum = hashlib.sha256()
        with incoming.open("wb") as handle:
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                total += len(chunk)
                if total > LIMIT:
                    raise ValueError("Release upload too large")
                checksum.update(chunk)
                handle.write(chunk)
        if checksum.hexdigest() != expected:
            raise ValueError("Release checksum mismatch")
        target = BASE / (tag + "-" + commit[:12])
        if target.exists():
            marker = target / "DEPLOYED.json"
            if marker.is_file():
                result = json.loads(marker.read_text())
                current = json.loads((BASE / "current.json").read_text())
                if result.get("commit") == commit and current.get("commit") == commit:
                    subprocess.run(["python3", str(target / "scripts/release/deploy.py"),
                                    "--verify-only", str(target)], check=True, pass_fds=(lock.fileno(),))
                    incoming.unlink()
                    print(json.dumps({"status": "already_deployed", "tag": tag, "commit": commit}))
                    return
            # Failed releases retain their evidence; reruns get a fresh workspace.
            suffix = 1
            while target.with_name(target.name + ".attempt-" + str(suffix)).exists():
                suffix += 1
            target = target.with_name(target.name + ".attempt-" + str(suffix))
        target.mkdir(mode=0o700)
        with tarfile.open(incoming, "r:gz") as archive:
            members = archive.getmembers()
            validate_members(members)
            for item in members:
                destination = target / item.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(item) as source, destination.open("wb") as out:
                    shutil.copyfileobj(source, out)
                destination.chmod(0o600)
        manifest = json.loads((target / "release-manifest.json").read_text())
        if manifest.get("tag") != tag or manifest.get("commit") != commit:
            raise ValueError("Release metadata mismatch")
        actual_names = {p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file()}
        if actual_names != set(manifest["files"]) | {"release-manifest.json"}:
            raise ValueError("Release manifest file set mismatch")
        for name, expected_hash in manifest["files"].items():
            if hashlib.sha256((target / name).read_bytes()).hexdigest() != expected_hash:
                raise ValueError("Release file checksum mismatch")
        subprocess.run(["python3", str(target / "scripts/release/deploy.py"), str(target)], check=True,
                       pass_fds=(lock.fileno(),))
        incoming.unlink()


if __name__ == "__main__":
    try:
        receive()
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error)[:300]}), file=sys.stderr)
        sys.exit(1)
