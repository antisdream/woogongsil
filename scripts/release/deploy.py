#!/usr/bin/env python3
"""Deploy a checked release, preserving runtime data and recovering on failure."""
import argparse
import hashlib
import json
import os
import shutil
import signal
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

APP = Path("/home/ubuntu/wgs_deploy/ExamAppProject")
BASE = Path("/home/ubuntu/wgs_deploy/github-releases")
DB_HELPER = "/home/ubuntu/wgs_deploy/patches/bootcamp_feature_removal_20260825_1120/audit-tools/dump_mysql_from_env.js"
PRESERVED_STATIC = ("AppleSDGothicNeo_Font", "question_image", "ipep-img")
ADMIN_ACCESS = Path('/home/ubuntu/wgs_deploy/admin-access')


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


def request(path, method="GET", data=None, headers=None):
    req = urllib.request.Request("http://127.0.0.1:5000" + path, method=method, data=data,
                                 headers={"Host": "woogongsil.site", "User-Agent": "WGS-Release-Healthcheck",
                                          "X-WGS-Client-Id": "wgs-release-healthcheck-00000001",
                                          "Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def administrator_device_headers():
    # Only rollback to v2.4.2 needs the gateway secret and public certificate,
    # never either administrator device's private key.
    policy = json.loads((ADMIN_ACCESS / 'policy.json').read_text(encoding='utf-8-sig'))
    certificate = (ADMIN_ACCESS / 'notebook.pem').read_text()
    fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate)).hexdigest()
    devices = policy.get('devices', [])
    pins = {item.get('sha256') for item in devices}
    if (policy.get('version') != 1 or len(devices) != 2 or len(pins) != 2 or fingerprint not in pins
            or not re.fullmatch(r'[0-9a-f]{64}', policy.get('gatewaySecret', ''))):
        raise RuntimeError('Administrator device configuration is not ready')
    return {'X-WGS-Admin-Gateway': policy['gatewaySecret'], 'X-WGS-Admin-Verify': 'SUCCESS',
            'X-WGS-Admin-Certificate': urllib.parse.quote(certificate, safe='')}


def health(manifest):
    for attempt in range(15):
        try:
            if request("/")[0] != 200:
                raise RuntimeError("Application pages are unavailable")
            if request("/manage/")[0] != 200:
                raise RuntimeError("Administrator login page is unavailable")
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
            code, payload = request("/api/visitors/summary")
            result = json.loads(payload)
            if (code != 200 or result.get("success") is not True
                    or set(result) != {"success", "todayCount", "totalCount"}
                    or any(type(result.get(key)) is not int or result[key] < 0
                           for key in ("todayCount", "totalCount"))
                    or result["todayCount"] > result["totalCount"]):
                raise RuntimeError("Public visitor summary verification failed")
            return
        except (OSError, ValueError, RuntimeError) as error:
            if attempt == 14:
                raise RuntimeError("Release health verification failed") from error
            time.sleep(2)


def recovery_health():
    for attempt in range(15):
        try:
            if request("/")[0] == 200:
                page, api = request("/manage/")[0], request("/api/admin/auth/me")[0]
                if page == 200 and api == 401:
                    return  # Public login pages before v2.4.2 and from v2.4.3 onward.
                if page == 404 and api == 404:
                    headers = administrator_device_headers()
                    if request("/manage/", headers=headers)[0] == 200 and request("/api/admin/auth/me", headers=headers)[0] == 401:
                        return
        except OSError:
            pass
        if attempt < 14:
            time.sleep(2)
    raise RuntimeError("Restored application HTTP checks failed")


def edge_health(manifest, phase):
    checks = [("/version.json", 200), ("/api/gatekeeper/status", 200),
              ("/api/admin/auth/me", 401), ("/api/questions", 410)]
    for route, expected in checks:
        req = urllib.request.Request("https://woogongsil.site" + route,
            headers={"User-Agent": "WGS-Release-Healthcheck", "Origin": "https://untrusted.example"})
        try:
            response = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(100000)
            if response.status != expected or response.headers.get("Strict-Transport-Security") != "max-age=300":
                raise RuntimeError("HTTPS security release probe failed")
            if response.headers.get("Access-Control-Allow-Origin"):
                raise RuntimeError("Untrusted browser origin was allowed")
            if "script-src 'self';" not in response.headers.get("Content-Security-Policy", ""):
                raise RuntimeError("HTTPS script policy differs")
            if route == "/version.json" and json.loads(body).get("commit") != manifest["commit"]:
                raise RuntimeError("HTTPS release commit differs")
        if phase == 'dry-run':
            time.sleep(2)


class Deployment:
    def __init__(self, app, base, release, runner=None, verifier=None, recovery_verifier=None, edge_verifier=None):
        self.app, self.base, self.release = app, base, release
        self.manifest = json.loads((release / "release-manifest.json").read_text())
        self.previous = json.loads((base / "current.json").read_text())
        self.before = release / "before"
        self.runner = runner or self.run
        self.verifier = verifier or health
        self.recovery_verifier = recovery_verifier or recovery_health
        self.edge_verifier = edge_verifier or edge_health
        self.security_enabled = "backend/services/schemaRuntime.js" in self.manifest["managed"]
        self.runtime_prepared = False
        self.edge_attempted = False
        self.server_stopped = False
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
        if self.security_enabled and not self.migration_marker.is_file():
            raise RuntimeError("The previous notice migration must already be recorded before this security release")

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
        backup_env = self.app / "backend/.env"
        if self.security_enabled:
            self.security("prepare")
            self.runtime_prepared = True
            backup_env = self.app.parent / "private/db-migration.env"
        self.runner(["node", DB_HELPER, str(backup_env), str(self.before / "mysql.sql.gz")])
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
        if self.security_enabled:
            self.edge("prepare")
        atomic_json(self.before / "snapshot.json", {"managed": names, "databaseSha256": digest(self.before / "mysql.sql.gz")})

    def security(self, operation):
        self.runner(["node", str(self.release / "scripts/release/security-runtime.cjs"), operation,
                     "--app-root", str(self.app), "--backup-dir", str(self.before)])

    def edge(self, operation, phase=None):
        arguments = ["sudo", "-n", "python3", str(self.release / "scripts/release/configure_edge.py"), operation,
                     "--app-root", str(self.app), "--backup-dir", str(self.before / "edge")]
        if phase: arguments += ["--phase", phase]
        self.runner(arguments)

    def migration(self, operation):
        self.runner(["node", str(self.release / "scripts/release/migrate-notices.cjs"), operation,
                     "--app-root", str(self.app), "--backup-dir", str(self.before)])

    def apply(self):
        if self.security_enabled:
            self.server_stopped = True
            self.runner(["pm2", "stop", "wgs-backend"])
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
        if self.security_enabled:
            self.security("activate")
            self.edge_attempted = True
            self.edge("apply", "dry-run")
            self.security("restart")
            self.server_stopped = False
            self.verifier(self.manifest)
            self.edge_verifier(self.manifest, "dry-run")
            self.edge("apply", "enforced")
            self.edge_verifier(self.manifest, "enforced")
        else:
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
        security_error = None
        if self.edge_attempted:
            try:
                self.edge("rollback")
            except Exception as error:
                security_error = error
        if self.runtime_prepared:
            try:
                self.security("rollback")
            except Exception as error:
                security_error = security_error or error
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
        if self.source_changed or self.server_stopped:
            if self.security_enabled:
                self.security("restart")
            else:
                self.runner(["pm2", "restart", "wgs-backend"])
            self.recovery_verifier()
        atomic_json(self.base / "current.json", self.previous)
        atomic_json(self.release / "FAILED.json", {"status": "rolled_back" if not (migration_error or security_error) else "rollback_requires_review",
                                                  "tag": self.manifest["tag"], "commit": self.manifest["commit"]})
        if migration_error:
            raise RuntimeError("Source recovered; notice rollback needs review") from migration_error
        if security_error:
            raise RuntimeError("Source recovered; security configuration rollback needs review") from security_error

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
