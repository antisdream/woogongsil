import json
import unittest
from unittest.mock import patch
import deploy


class AdministratorDeviceHealthTests(unittest.TestCase):
    def test_release_requires_both_denied_and_approved_device_boundaries(self):
        manifest = {'version':'2.4.2', 'tag':'v2.4.2', 'commit':'a'*40}
        broken = None

        def request(path, *_args, headers=None):
            if path == '/': return 200, b'html'
            if path == '/manage/':
                return (404 if broken == 'approved_page' else 200, b'html') if headers else (200 if broken == 'public_page' else 404, b'')
            if path == '/api/admin/auth/me':
                return (200 if broken == 'approved_api' else 401, b'{}') if headers else (401 if broken == 'public_api' else 404, b'')
            if path == '/version.json': return 200, json.dumps(manifest).encode()
            if path == '/api/online-users': return 404, b'{}'
            if path == '/api/visitors/visit': return 200, b'{"success":true,"counted":false,"ignored":true}'
            if path == '/api/visitors/summary': return 200, b'{"success":true,"todayCount":0,"totalCount":375}'
            self.fail('Unexpected route')

        with patch.object(deploy, 'request', request), patch.object(deploy.time, 'sleep'), \
                patch.object(deploy, 'administrator_device_headers', return_value={'test':'approved'}):
            deploy.health(manifest)
            for broken in ('public_page','public_api','approved_page','approved_api'):
                with self.subTest(boundary=broken), self.assertRaisesRegex(RuntimeError, 'Release health verification failed'):
                    deploy.health(manifest)

    def test_recovery_accepts_prior_and_device_gated_release_shapes(self):
        for gated in (False, True):
            def request(path, *_args, headers=None):
                if path == '/': return 200, b'html'
                if path == '/manage/': return (404 if gated and not headers else 200), b'html'
                if path == '/api/admin/auth/me': return (404 if gated and not headers else 401), b'{}'
                self.fail('Unexpected recovery request')
            with self.subTest(gated=gated), patch.object(deploy, 'request', request), \
                    patch.object(deploy, 'administrator_device_headers', return_value={'test':'approved'}):
                deploy.recovery_health()


if __name__ == '__main__':
    unittest.main()
