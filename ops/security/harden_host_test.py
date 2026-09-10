import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('host', Path(__file__).with_name('harden_host.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'root'
        self.root.mkdir()
        for name in host.FILES[1:]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('IPV6=yes\nDEFAULT_INPUT_POLICY="ACCEPT"\n' if name == 'etc/default/ufw' else 'original ' + name)
        self.original = {name: (self.root / name).read_bytes() for name in host.FILES[1:]}
        self.calls, self.active, self.added, self.failure = [], False, '', None
        self.time = 1000
        self.policy = host.HostPolicy(self.root, Path(self.temp.name) / 'state', self.run_command, lambda: self.time)

    def tearDown(self):
        self.temp.cleanup()

    def run_command(self, args):
        self.calls.append(args)
        if args == self.failure:
            self.failure = None
            raise RuntimeError('injected command failure')
        if args == ['sshd', '-T']:
            source = self.root / host.SSH_FILE
            return 'port 22\n' + (source.read_text().lower() if source.exists() else 'pubkeyauthentication yes\npasswordauthentication no\npermitrootlogin without-password')
        if args == ['ufw', 'show', 'added']:
            return self.added
        if args[:2] == ['ufw', 'status']:
            return ('Status: active\nDefault: deny (incoming), allow (outgoing)\n' + '\n'.join(str(p) + '/tcp ALLOW IN Anywhere' for p in (22, 80, 443))) if self.active else 'Status: inactive'
        if args == ['ufw', '--force', 'enable']:
            self.active = True
        elif args == ['ufw', '--force', 'disable']:
            self.active = False
        elif args[:2] == ['ufw', 'allow']:
            for name in ('etc/ufw/user.rules', 'etc/ufw/user6.rules'):
                with (self.root / name).open('a') as target:
                    target.write('\n' + ' '.join(args))
        return ''

    def test_timer_precedes_network_changes_and_confirmation_is_separate(self):
        result = self.policy.apply()
        self.assertEqual(result['status'], 'pending_second_ssh_confirmation')
        timer = next(i for i, command in enumerate(self.calls) if command[0] == 'systemd-run')
        reload = self.calls.index(['systemctl', 'reload', 'ssh.service'])
        self.assertLess(timer, reload)
        self.assertTrue(self.active)
        self.assertNotIn(['systemctl', 'stop', host.UNIT + '.timer'], self.calls)
        self.assertEqual(self.policy.confirm()['status'], 'confirmed')
        self.assertIn(['systemctl', 'stop', host.UNIT + '.timer'], self.calls)
        self.assertEqual(self.policy.apply()['status'], 'already_confirmed')

    def test_unconfirmed_timeout_restores_all_original_bytes_and_inactive_state(self):
        self.policy.apply()
        self.time += 180
        self.assertEqual(self.policy.rollback()['status'], 'rolled_back')
        self.assertFalse(self.active)
        self.assertFalse((self.root / host.SSH_FILE).exists())
        for name, content in self.original.items():
            self.assertEqual((self.root / name).read_bytes(), content)

    def test_mid_apply_failure_restores_existing_policy(self):
        self.active = True
        prior = self.root / host.SSH_FILE
        prior.parent.mkdir(parents=True, exist_ok=True)
        prior.write_text('PubkeyAuthentication yes\nPasswordAuthentication no\n')
        saved = prior.read_bytes()
        self.failure = ['ufw', '--force', 'enable']
        with self.assertRaisesRegex(RuntimeError, 'injected'):
            self.policy.apply()
        self.assertEqual(prior.read_bytes(), saved)
        self.assertTrue(self.active)
        self.assertEqual(self.policy.load()['status'], 'rolled_back')

    def test_timer_failure_changes_no_network_configuration(self):
        real_runner = self.policy.runner
        self.policy.runner = lambda args: (_ for _ in ()).throw(RuntimeError('timer unavailable')) if args[0] == 'systemd-run' else real_runner(args)
        with self.assertRaisesRegex(RuntimeError, 'timer unavailable'):
            self.policy.apply()
        self.assertFalse((self.root / host.SSH_FILE).exists())
        self.assertFalse(self.active)

    def test_late_confirmation_cannot_cancel_rollback(self):
        self.policy.apply()
        self.time += 151
        with self.assertRaisesRegex(RuntimeError, 'window closed'):
            self.policy.confirm()
        self.assertNotIn(['systemctl', 'stop', host.UNIT + '.timer'], self.calls)

    def test_unrelated_firewall_rule_is_not_silently_removed(self):
        self.added = 'ufw allow 3306/tcp'
        with self.assertRaisesRegex(RuntimeError, 'explicit review'):
            self.policy.apply()
        self.assertFalse(self.policy.state.exists())

    def test_observed_legacy_443_rule_becomes_tcp_only_after_timer(self):
        self.added = 'ufw allow 443'
        self.policy.apply()
        deletion = self.calls.index(['ufw', '--force', 'delete', 'allow', '443'])
        timer = next(i for i, args in enumerate(self.calls) if args[0] == 'systemd-run')
        self.assertGreater(deletion, timer)
        self.assertIn(['ufw', 'allow', '443/tcp', 'comment', 'wgs-security'], self.calls)

    def test_corrupted_effective_policy_cannot_be_confirmed(self):
        self.policy.apply()
        (self.root / host.SSH_FILE).write_text('PubkeyAuthentication yes\nPasswordAuthentication yes\n')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            self.policy.confirm()
        self.assertNotIn(['systemctl', 'stop', host.UNIT + '.timer'], self.calls)

    def test_confirmed_policy_is_not_undone_by_a_late_timer(self):
        self.policy.apply()
        self.policy.confirm()
        self.assertEqual(self.policy.rollback()['status'], 'confirmed')
        self.assertTrue(self.active)


if __name__ == '__main__':
    unittest.main()
