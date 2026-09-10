import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock
from pathlib import Path


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


deploy = module("deploy")
receive = module("receive")
package = module("package")


class ReleaseSafetyTests(unittest.TestCase):
    def test_private_db_environment_can_resolve_existing_backend_dependencies(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app, base, release, _calls, _runner = self.fixture(root)
            dependency = app / 'backend/node_modules/dotenv/index.js'
            dependency.parent.mkdir(parents=True)
            dependency.write_text("module.exports = { ready: true };", encoding='utf-8')
            private = root / 'private'
            private.mkdir()
            environment_file = private / 'db-migration.env'
            environment_file.write_text('synthetic-db-settings', encoding='utf-8')
            helper = root / 'legacy-dump.cjs'
            helper.write_text("const path=require('path');const location=require.resolve('dotenv',{paths:[path.dirname(process.argv[2])]});if(!require(location).ready)process.exit(2);console.log('dependency_loaded');", encoding='utf-8')
            arguments = ['node', str(helper), str(environment_file)]
            without_context = subprocess.run(arguments, env={**os.environ, 'NODE_PATH': ''}, capture_output=True)
            self.assertNotEqual(without_context.returncode, 0)
            task = deploy.Deployment(app, base, release)
            with mock.patch.object(deploy, 'DB_HELPER', str(helper)):
                task.run(arguments)
            self.assertEqual((release / 'deployment-private.log').read_text().strip(), 'dependency_loaded')
            self.assertEqual(environment_file.read_text(), 'synthetic-db-settings')

    def test_archive_rejects_traversal_links_duplicates_and_environment(self):
        valid = [tarfile.TarInfo("release-manifest.json"), tarfile.TarInfo("scripts/release/deploy.py")]
        receive.validate_members(valid)
        for name in ("app/../backend/server.js", "/app/backend/server.js", "app/backend/.env", "app/backend/uploads/photo.png"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                receive.validate_members(valid + [tarfile.TarInfo(name)])
        link = tarfile.TarInfo("app/backend/server.js")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        with self.assertRaises(ValueError):
            receive.validate_members(valid + [link])
        with self.assertRaises(ValueError):
            receive.validate_members(valid + [valid[0]])

    def test_runtime_files_cannot_be_managed(self):
        for name in ("backend/.env", "backend/posts_data.json", "backend/users_data.json", "backend/uploads/x.js", "frontend/dist/index.html", "../server.js"):
            with self.subTest(name=name):
                self.assertFalse(package.managed_path(name))
        self.assertTrue(package.managed_path("backend/routes/visitorRoutes.js"))

    def fixture(self, root):
        app, base, release = root / "app", root / "base", root / "base/release"
        for folder in (app / "backend", app / "frontend/dist/assets", release / "app/backend", release / "app/frontend/dist/assets"):
            folder.mkdir(parents=True)
        (app / "backend/server.js").write_text("old-source")
        (app / "backend/.env").write_text("must-stay-private")
        (app / "backend/posts_data.json").write_text("runtime-data")
        (app / "frontend/dist/index.html").write_text("old-dist")
        (app / "frontend/dist/assets/old.js").write_text("old-chunk")
        (app / "backend/package-lock.json").write_text("same-lock")
        (release / "app/backend/package-lock.json").write_text("same-lock")
        (release / "app/backend/server.js").write_text("new-source")
        (release / "app/frontend/dist/index.html").write_text("new-dist")
        managed = ["backend/server.js", "backend/package-lock.json"]
        previous = {"tag": "v2.3.0", "commit": "a" * 40, "managed": managed,
                    "hashes": {n: deploy.digest(app / n) for n in managed}}
        manifest = {"version": "2.4.0", "tag": "v2.4.0", "commit": "b" * 40, "managed": managed,
                    "files": {"app/" + n: deploy.digest(release / "app" / n) for n in managed}}
        deploy.atomic_json(base / "current.json", previous)
        deploy.atomic_json(release / "release-manifest.json", manifest)
        calls = []

        def runner(args, cwd=None):
            calls.append(args)
            if len(args) > 1 and args[1] == deploy.DB_HELPER:
                Path(args[-1]).write_bytes(b"logical-db-backup")

        return app, base, release, calls, runner

    def test_failed_health_restores_source_dist_and_preserves_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            app, base, release, calls, runner = self.fixture(Path(folder))

            def failure(_):
                raise RuntimeError("synthetic health failure")

            recovered = []
            task = deploy.Deployment(app, base, release, runner, failure, lambda: recovered.append(True))
            with self.assertRaisesRegex(RuntimeError, "synthetic health failure"):
                task.execute()
            self.assertEqual((app / "backend/server.js").read_text(), "old-source")
            self.assertEqual((app / "frontend/dist/index.html").read_text(), "old-dist")
            self.assertEqual((app / "backend/.env").read_text(), "must-stay-private")
            self.assertEqual((app / "backend/posts_data.json").read_text(), "runtime-data")
            self.assertEqual(json.loads((base / "current.json").read_text())["commit"], "a" * 40)
            self.assertTrue(any("rollback" in args for args in calls))
            self.assertFalse((base / "notice-v2.4.0-applied.json").exists())
            self.assertEqual(recovered, [True])

    def test_success_keeps_previous_chunks_and_records_scoped_migration_once(self):
        with tempfile.TemporaryDirectory() as folder:
            app, base, release, calls, runner = self.fixture(Path(folder))
            task = deploy.Deployment(app, base, release, runner, lambda _: None)
            task.execute()
            self.assertEqual((app / "backend/server.js").read_text(), "new-source")
            self.assertEqual((app / "frontend/dist/assets/old.js").read_text(), "old-chunk")
            self.assertTrue((base / "notice-v2.4.0-applied.json").is_file())
            self.assertEqual(json.loads((base / "current.json").read_text())["commit"], "b" * 40)

    def test_drift_stops_before_backup_or_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            app, base, release, calls, runner = self.fixture(Path(folder))
            (app / "backend/server.js").write_text("unexpected-work")
            task = deploy.Deployment(app, base, release, runner, lambda _: None)
            with self.assertRaisesRegex(RuntimeError, "drift"):
                task.execute()
            self.assertEqual(calls, [])
            self.assertEqual((app / "backend/server.js").read_text(), "unexpected-work")

    def security_fixture(self, root, fail_phase=None):
        app, base, release, calls, original_runner = self.fixture(root)
        candidate = release / 'app/backend/services/schemaRuntime.js'
        candidate.parent.mkdir(parents=True); candidate.write_text('migration-guard')
        manifest = json.loads((release / 'release-manifest.json').read_text())
        manifest['managed'].append('backend/services/schemaRuntime.js')
        manifest['files']['app/backend/services/schemaRuntime.js'] = deploy.digest(candidate)
        deploy.atomic_json(release / 'release-manifest.json', manifest)
        deploy.atomic_json(base / 'notice-v2.4.0-applied.json', {'commit': 'prior'})
        def runner(args, cwd=None):
            original_runner(args, cwd)
            if len(args) > 1 and args[1].endswith('security-runtime.cjs'):
                operation = args[2]
                if operation == 'prepare':
                    (release / 'before/backend.env').write_bytes((app / 'backend/.env').read_bytes())
                if operation == 'activate': (app / 'backend/.env').write_text('restricted-runtime-identity')
                if operation == 'rollback': (app / 'backend/.env').write_bytes((release / 'before/backend.env').read_bytes())
            if fail_phase and '--phase' in args and args[-1] == fail_phase:
                raise RuntimeError('synthetic edge failure')
        return app, base, release, calls, runner

    def test_security_failure_restores_environment_code_and_edge_before_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            app, base, release, calls, runner = self.security_fixture(Path(folder), 'enforced')
            observed = []
            task = deploy.Deployment(app, base, release, runner, lambda _: None,
                lambda: observed.append((app / 'backend/.env').read_text()), lambda _manifest, phase: observed.append(phase))
            with self.assertRaisesRegex(RuntimeError, 'synthetic edge failure'): task.execute()
            self.assertEqual((app / 'backend/server.js').read_text(), 'old-source')
            self.assertEqual((app / 'backend/.env').read_text(), 'must-stay-private')
            self.assertEqual((app / 'backend/posts_data.json').read_text(), 'runtime-data')
            self.assertEqual(json.loads((base / 'current.json').read_text())['commit'], 'a' * 40)
            self.assertEqual(observed, ['dry-run', 'must-stay-private'])
            edge_rollback = next(i for i, call in enumerate(calls) if any(str(item).endswith('configure_edge.py') for item in call) and 'rollback' in call)
            env_rollback = next(i for i, call in enumerate(calls) if len(call) > 2 and call[1].endswith('security-runtime.cjs') and call[2] == 'rollback')
            restart = max(i for i, call in enumerate(calls) if len(call) > 2 and call[1].endswith('security-runtime.cjs') and call[2] == 'restart')
            self.assertLess(edge_rollback, restart); self.assertLess(env_rollback, restart)
            self.assertEqual(json.loads((release / 'FAILED.json').read_text())['status'], 'rolled_back')

    def test_security_success_requires_dry_run_then_enforcement_and_privileged_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            app, base, release, calls, runner = self.security_fixture(Path(folder))
            phases = []
            task = deploy.Deployment(app, base, release, runner, lambda _: None, edge_verifier=lambda _manifest, phase: phases.append(phase))
            task.execute()
            self.assertEqual(phases, ['dry-run', 'enforced'])
            backup_call = next(call for call in calls if len(call) > 1 and call[1] == deploy.DB_HELPER)
            self.assertEqual(backup_call[2], str(app.parent / 'private/db-migration.env'))
            stop = calls.index(['pm2', 'stop', 'wgs-backend'])
            activate = next(i for i, call in enumerate(calls) if len(call) > 2 and call[1].endswith('security-runtime.cjs') and call[2] == 'activate')
            self.assertLess(stop, activate)
            self.assertEqual(json.loads((base / 'current.json').read_text())['commit'], 'b' * 40)


if __name__ == "__main__":
    unittest.main()
