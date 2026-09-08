import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
