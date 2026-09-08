#!/usr/bin/env python3
"""Deploy a checked release, preserving runtime data and recovering on failure."""
import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

APP = Path("/home/ubuntu/wgs_deploy/ExamAppProject")
BASE = Path("/home/ubuntu/wgs_deploy/github-releases")
DB_HELPER = "/home/ubuntu/wgs_deploy/patches/bootcamp_feature_removal_20260825_1120/audit-tools/dump_mysql_from_env.js"
PRESERVED_STATIC = ("AppleSDGothicNeo_Font", "question_image", "ipep-img")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def safe_managed(name):
    from importlib.util import spec_from_file_location, module_from_spec
    spec = spec_from_file_location("release_package", Path(__file__).with_name("package.py"))
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.managed_path(name)


def checked_path(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise RuntimeError("Protected or redirected path: " + name)
    return path


def request(path, method="GET", data=None):
    req = urllib.request.Request("http://127.0.0.1:5000" + path, method=method, data=data,
                                 headers={"Host": "woogongsil.site", "User-Agent": "WGS-Release-Healthcheck",
                                          "X-WGS-Client-Id": "wgs-release-healthcheck-00000001",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def health(manifest):
    for attempt in range(15):
        try:
            if request("/")[0] != 200 or request("/manage/")[0] != 200:
                raise RuntimeError("Application pages are unavailable")
            if request("/api/admin/auth/me")[0] != 401:
                raise RuntimeError("Administrator authentication boundary failed")
            code, payload = request("/version.json")
            current = json.loads(payload)
            if code != 200 or any(current.get(k) != manifest[k] for k in ("version", "tag", "commit")):
                raise RuntimeError("Deployed release marker differs")
            if request("/api/online-users", "POST", b"{}")[0] != 404:
                raise RuntimeError("Retired public presence endpoint is available")
            code, payload = request("/api/visitors/visit", "POST", b"{}")
            result = json.loads(payload)
            if (code != 200 or not result.get("success") or result.get("counted") is not False
                    or not result.get("ignored") or set(result) - {"success", "counted", "ignored", "reason"}):
                raise RuntimeError("Private visitor aggregate boundary failed")
            return
        except (OSError, ValueError, RuntimeError) as error:
            if attempt == 14:
                raise RuntimeError("Release health verification failed") from error
            time.sleep(2)


def recovery_health():
    for attempt in range(15):
        try:
            if request("/")[0] == 200 and request("/manage/")[0] == 200 and request("/api/admin/auth/me")[0] == 401:
                return
        except OSError:
            pass
        if attempt < 14:
            time.sleep(2)
    raise RuntimeError("Restored application HTTP checks failed")


class Deployment:
    def __init__(self, app, base, release, runner=None, verifier=None, recovery_verifier=None):
        self.app, self.base, self.release = app, base, release
        self.manifest = json.loads((release / "release-manifest.json").read_text())
        self.previous = json.loads((base / "current.json").read_text())
        self.before = release / "before"
        self.runner = runner or self.run
        self.verifier = verifier or health
        self.recovery_verifier = recovery_verifier or recovery_health
        self.source_changed = False
        self.dist_changed = False
        self.dependencies_changed = False
        self.migration_attempted = False
        self.old_dist_moved = False
        self.migration_marker = base / "notice-v2.4.0-applied.json"

    def run(self, args, cwd=None):
        with (self.release / "deployment-private.log").open("ab") as log:
            subprocess.run(args, cwd=cwd, stdout=log, stderr=log, check=True, timeout=300)

    def validate(self):
        if self.app.is_symlink() or self.app.resolve() != self.app:
            raise RuntimeError("Application root must be the configured real directory")
        if (self.app / "frontend/dist").is_symlink():
            raise RuntimeError("Unexpected redirected distribution")
        names = set(self.manifest["managed"]) | set(self.previous["managed"])
        for name in names:
            if not safe_managed(name):
                raise RuntimeError("Release tries to manage a protected file")
            checked_path(self.app, name)
        for name, expected in self.previous["hashes"].items():
            if digest(checked_path(self.app, name)) != expected:
                raise RuntimeError("Server source drift requires review: " + name)
        for name in self.manifest["managed"]:
            candidate = checked_path(self.release / "app", name)
            if not candidate.is_file() or digest(candidate) != self.manifest["files"].get("app/" + name):
                raise RuntimeError("Invalid managed release file")
            if name not in self.previous["managed"] and (self.app / name).exists():
                raise RuntimeError("New managed file collides with server data: " + name)
        disk = shutil.disk_usage(self.base)
        if disk.free < 2 * 1024 ** 3:
            raise RuntimeError("At least 2 GiB of free deployment disk is required")

    def prepare(self):
        self.before.mkdir(mode=0o700)
        atomic_json(self.before / "previous-state.json", self.previous)
        names = sorted(set(self.manifest["managed"]) | set(self.previous["managed"]))
        for name in names:
            source = checked_path(self.app, name)
            if source.is_file():
                target = self.before / "source" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        self.runner(["node", DB_HELPER, str(self.app / "backend/.env"), str(self.before / "mysql.sql.gz")])
        self.runner(["gzip", "-t", str(self.before / "mysql.sql.gz")])
        new_dist = self.release / "app/frontend/dist"
        for name in PRESERVED_STATIC:
            source = checked_path(self.app / "frontend/dist", name)
            target = new_dist / name
            if source.exists():
                if target.exists() or not source.is_dir():
                    raise RuntimeError("Preserved static data collision: " + name)
                shutil.copytree(source, target, symlinks=False)
        # Keep prior hashed chunks available for tabs already open during the release.
        assets = self.app / "frontend/dist/assets"
        if assets.is_dir():
            for source in assets.iterdir():
                target = new_dist / "assets" / source.name
                if source.is_file() and not source.is_symlink() and not target.exists():
                    shutil.copy2(source, target)
        old_lock = digest(self.app / "backend/package-lock.json")
        new_lock = digest(self.release / "app/backend/package-lock.json")
        if old_lock != new_lock:
            self.runner(["npm", "ci", "--omit=dev", "--no-audit", "--no-fund"], cwd=self.release / "app/backend")
        self.replace_dependencies = old_lock != new_lock
        atomic_json(self.before / "snapshot.json", {"managed": names, "databaseSha256": digest(self.before / "mysql.sql.gz")})

    def migration(self, operation):
        self.runner(["node", str(self.release / "scripts/release/migrate-notices.cjs"), operation,
                     "--app-root", str(self.app), "--backup-dir", str(self.before)])

    def apply(self):
        self.source_changed = True
        for name in self.manifest["managed"]:
            target = checked_path(self.app, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".release-tmp")
            shutil.copy2(self.release / "app" / name, temporary)
            temporary.replace(target)
        for name in set(self.previous["managed"]) - set(self.manifest["managed"]):
            checked_path(self.app, name).unlink(missing_ok=True)
        if self.replace_dependencies:
            (self.app / "backend/node_modules").rename(self.before / "node_modules")
            self.dependencies_changed = True
            (self.release / "app/backend/node_modules").rename(self.app / "backend/node_modules")
        (self.app / "frontend/dist").rename(self.before / "dist")
        self.old_dist_moved = True
        (self.release / "app/frontend/dist").rename(self.app / "frontend/dist")
        self.dist_changed = True
        if not self.migration_marker.exists():
            self.migration_attempted = True
            self.migration("apply")
        self.runner(["pm2", "restart", "wgs-backend"])
        self.verifier(self.manifest)
        if self.migration_attempted:
            atomic_json(self.migration_marker, {"commit": self.manifest["commit"], "backup": str(self.before)})
        state = {"tag": self.manifest["tag"], "commit": self.manifest["commit"],
                 "managed": self.manifest["managed"],
                 "hashes": {n: digest(self.app / n) for n in self.manifest["managed"]}}
        atomic_json(self.base / "current.json", state)
        atomic_json(self.release / "DEPLOYED.json", {"status": "deployed", "tag": state["tag"], "commit": state["commit"]})

    def rollback(self):
        # Roll back only the scoped notice migration, never restore the whole live DB.
        migration_error = None
        if self.migration_attempted:
            try:
                self.migration("rollback")
            except Exception as error:
                migration_error = error
            if not migration_error:
                self.migration_marker.unlink(missing_ok=True)
        if self.source_changed:
            for name in set(self.manifest["managed"]) | set(self.previous["managed"]):
                target = checked_path(self.app, name)
                saved = self.before / "source" / name
                if saved.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(saved, target)
                else:
                    target.unlink(missing_ok=True)
        if self.old_dist_moved:
            if self.dist_changed:
                (self.app / "frontend/dist").rename(self.release / "failed-dist")
            (self.before / "dist").rename(self.app / "frontend/dist")
        if self.dependencies_changed:
            current = self.app / "backend/node_modules"
            if current.exists():
                current.rename(self.release / "failed-node_modules")
            (self.before / "node_modules").rename(current)
        if self.source_changed:
            self.runner(["pm2", "restart", "wgs-backend"])
            self.recovery_verifier()
        atomic_json(self.base / "current.json", self.previous)
        atomic_json(self.release / "FAILED.json", {"status": "rolled_back" if not migration_error else "notice_rollback_requires_review",
                                                  "tag": self.manifest["tag"], "commit": self.manifest["commit"]})
        if migration_error:
            raise RuntimeError("Source recovered; notice rollback needs review") from migration_error

    def execute(self):
        self.validate()
        self.prepare()
        try:
            self.apply()
        except Exception:
            # Finish recovery even when the SSH connection or Actions run terminates.
            for name in ("SIGTERM", "SIGHUP", "SIGINT"):
                if hasattr(signal, name):
                    signal.signal(getattr(signal, name), signal.SIG_IGN)
            self.rollback()
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("release", type=Path)
    args = parser.parse_args()
    release = args.release.resolve()
    if not release.is_relative_to(BASE) or release.parent != BASE:
        parser.error("Release must be a direct child of the configured directory")
    if args.verify_only:
        health(json.loads((release / "release-manifest.json").read_text()))
        return
    os.umask(0o077)
    def interrupted(number, _frame):
        raise RuntimeError("Deployment interrupted by signal " + str(number))
    for name in ("SIGTERM", "SIGHUP", "SIGINT"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupted)
    deployment = Deployment(APP, BASE, release)
    deployment.execute()
    print(json.dumps({"status": "deployed", "tag": deployment.manifest["tag"], "commit": deployment.manifest["commit"]}))


if __name__ == "__main__":
    main()
