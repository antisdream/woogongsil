import json
import unittest
from unittest.mock import patch
import deploy


class VisitorHealthTests(unittest.TestCase):
    def test_public_summary_is_required_and_private_fields_fail_health(self):
        manifest = {"version": "2.4.1", "tag": "v2.4.1", "commit": "a" * 40}
        summary = {"success": True, "todayCount": 0, "totalCount": 375}

        def request(path, *_args):
            if path in ("/", "/manage/"):
                return 200, b"html"
            if path == "/api/admin/auth/me":
                return 401, b"{}"
            if path == "/version.json":
                return 200, json.dumps(manifest).encode()
            if path == "/api/online-users":
                return 404, b"{}"
            if path == "/api/visitors/visit":
                return 200, b'{"success":true,"counted":false,"ignored":true}'
            if path == "/api/visitors/summary":
                return 200, json.dumps(summary).encode()
            raise AssertionError("Unexpected health request")

        with patch.object(deploy, "request", request), patch.object(deploy.time, "sleep"):
            deploy.health(manifest)
            for invalid in (
                {**summary, "users": []}, {**summary, "todayCount": -1},
                {**summary, "todayCount": 376}, {**summary, "todayCount": True},
                {"success": False},
            ):
                with self.subTest(invalid=invalid):
                    summary = invalid
                    with self.assertRaisesRegex(RuntimeError, "Release health verification failed"):
                        deploy.health(manifest)


if __name__ == "__main__":
    unittest.main()
