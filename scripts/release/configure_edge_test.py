import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('edge', Path(__file__).with_name('configure_edge.py'))
edge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(edge)
SITE = '''server {
    server_name woogongsil.site www.woogongsil.site;
    location / { proxy_pass http://127.0.0.1:5000; proxy_set_header X-Forwarded-Proto $scheme; }
    # comment with }
    location = /example { return 200 '{"example":"}"}'; }
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/woogongsil.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/woogongsil.site/privkey.pem;
}
server { listen 80; server_name woogongsil.site www.woogongsil.site; return 301 https://$host$request_uri; }
'''


class EdgeTests(unittest.TestCase):
    def test_parser_preserves_tls_locations_and_redirect_without_duplicate_rules(self):
        first = edge.configured_site(SITE)
        self.assertEqual(first.count(edge.BEGIN), 2)
        self.assertEqual(first.count('include /etc/nginx/snippets/wgs-security-rate.conf'), 1)
        self.assertEqual(edge.configured_site(first), first)
        for line in SITE.splitlines():
            if 'ssl_certificate' in line or 'location /' in line: self.assertIn(line, first)
        self.assertIn('return 301 https://$host$request_uri;', first)

    def test_unknown_log_configuration_and_other_sites_are_not_overwritten(self):
        with self.assertRaisesRegex(RuntimeError, 'requires review'):
            edge.configured_site(SITE.replace('listen 443 ssl;', 'access_log /operator/log;\nlisten 443 ssl;'))
        with self.assertRaisesRegex(RuntimeError, 'Expected'):
            edge.configured_site(SITE.replace('woogongsil.site', 'another.site'))

    def test_mid_apply_nginx_failure_restores_exact_original_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'root'; source = root / edge.SITE
            source.parent.mkdir(parents=True); source.write_text(SITE)
            app = Path(__file__).resolve().parents[2]
            calls = []
            def run(args):
                calls.append(args)
                if args == ['nginx', '-t'] and sum(item == args for item in calls) == 1: raise RuntimeError('synthetic nginx failure')
                return ''
            task = edge.EdgeConfiguration(app, Path(folder) / 'before/edge', root, run)
            task.prepare()
            with self.assertRaisesRegex(RuntimeError, 'synthetic'): task.apply('dry-run')
            task.rollback()
            self.assertEqual(source.read_text(), SITE)
            for name in edge.TARGETS[1:]: self.assertFalse((root / name).exists())
            self.assertIn(['systemctl', 'reload', 'nginx'], calls)

    def test_dry_run_and_enforcement_are_separate_and_tls_is_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'root'; source = root / edge.SITE
            source.parent.mkdir(parents=True); source.write_text(SITE)
            calls = []
            task = edge.EdgeConfiguration(Path(__file__).resolve().parents[2], Path(folder) / 'before/edge', root, lambda args: calls.append(args) or '')
            task.prepare(); task.apply('dry-run')
            rate = root / 'etc/nginx/snippets/wgs-security-rate.conf'
            self.assertIn('limit_req_dry_run on;', rate.read_text())
            task.apply('enforced'); self.assertIn('limit_req_dry_run off;', rate.read_text())
            self.assertEqual(source.read_text().count(edge.BEGIN), 2)
            self.assertIn('ssl_certificate_key /etc/letsencrypt/live/woogongsil.site/privkey.pem;', source.read_text())
            self.assertEqual(calls.count(['systemctl', 'reload', 'nginx']), 2)


if __name__ == '__main__': unittest.main()
