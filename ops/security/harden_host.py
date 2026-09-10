#!/usr/bin/env python3
"""Bounded Ubuntu host policy with an independent timed rollback."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

STATE = Path('/var/lib/wgs-security/host-v1')
UNIT = 'wgs-host-security-v1'
SSH_FILE = 'etc/ssh/sshd_config.d/00-wgs-security.conf'
FILES = (SSH_FILE, 'etc/default/ufw', 'etc/ufw/ufw.conf', 'etc/ufw/user.rules', 'etc/ufw/user6.rules')
POLICY = {
    'PubkeyAuthentication': 'yes', 'PasswordAuthentication': 'no',
    'KbdInteractiveAuthentication': 'no', 'PermitRootLogin': 'no',
    'X11Forwarding': 'no', 'AllowTcpForwarding': 'no',
    'AllowAgentForwarding': 'no', 'PermitTunnel': 'no', 'MaxAuthTries': '3',
}


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45, env={**os.environ, 'LC_ALL': 'C'})
    if result.returncode:
        raise RuntimeError('Host command failed: ' + args[0])
    return result.stdout.strip()


class HostPolicy:
    def __init__(self, root=Path('/'), state=STATE, runner=run, clock=time.time):
        self.root, self.state, self.runner, self.clock = root, state, runner, clock

    def path(self, relative):
        target = self.root / relative
        if target.is_symlink() or not target.resolve().is_relative_to(self.root.resolve()):
            raise RuntimeError('Redirected configuration path')
        return target

    def save(self, value):
        target = self.state / 'state.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
        temporary.chmod(0o600)
        temporary.replace(target)

    def load(self):
        return json.loads((self.state / 'state.json').read_text())

    def effective(self):
        result = self.runner(['sshd', '-T'])
        return dict(line.split(' ', 1) for line in result.splitlines() if ' ' in line)

    def verify(self):
        effective = self.effective()
        if any(effective.get(key.lower()) != value for key, value in POLICY.items()):
            raise RuntimeError('Effective SSH policy differs; refusing confirmation')
        status = self.runner(['ufw', 'status', 'verbose'])
        if 'Status: active' not in status or 'deny (incoming)' not in status:
            raise RuntimeError('Incoming firewall policy is not active')
        for port in (22, 80, 443):
            if not re.search(r'^' + str(port) + r'/tcp\s+ALLOW IN\s', status, re.M):
                raise RuntimeError('Required firewall rule is missing')
        return {'ssh': {key: effective[key.lower()] for key in POLICY}, 'ufwActive': True, 'allowedTcpPorts': [22, 80, 443]}

    def apply(self):
        if (self.state / 'state.json').exists():
            state = self.load()
            if state['status'] == 'confirmed':
                return {'status': 'already_confirmed', **self.verify()}
            raise RuntimeError('Existing host policy attempt requires inspection')
        effective = self.effective()
        if effective.get('port') != '22' or effective.get('pubkeyauthentication') != 'yes':
            raise RuntimeError('Expected SSH key access on port 22')
        self.runner(['sshd', '-t'])
        added = self.runner(['ufw', 'show', 'added'])
        # Preserve known web/SSH rules. Do not silently close an unrelated service
        # or leave an unexpected broad allow rule hidden beneath this policy.
        for line in added.splitlines():
            if line.startswith('ufw ') and line != 'ufw allow 443' and not re.fullmatch(r"ufw allow (?:22|80|443)/tcp(?: comment '[^']*')?", line):
                raise RuntimeError('Existing firewall rules require explicit review')
        before_active = 'Status: active' in self.runner(['ufw', 'status'])
        self.state.mkdir(parents=True, mode=0o700)
        self.state.chmod(0o700)
        snapshot = {}
        for name in FILES:
            source = self.path(name)
            snapshot[name] = {'exists': source.exists(), 'mode': source.stat().st_mode & 0o777 if source.exists() else None}
            if source.exists():
                target = self.state / 'before' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        shutil.copy2(Path(__file__), self.state / 'harden_host.py')
        self.save({'status': 'pending', 'createdAt': self.clock(), 'ufwWasActive': before_active, 'files': snapshot})
        # The timer exists before either SSH or firewall configuration changes.
        self.runner(['systemd-run', '--unit=' + UNIT, '--on-active=180s', '--timer-property=AccuracySec=1s',
                     '/usr/bin/python3', str(self.state / 'harden_host.py'), 'rollback'])
        try:
            ssh = self.path(SSH_FILE)
            ssh.parent.mkdir(parents=True, exist_ok=True)
            ssh.write_text('# Managed by the WGS security release.\n' + ''.join(k + ' ' + v + '\n' for k, v in POLICY.items()))
            ssh.chmod(0o600)
            self.runner(['sshd', '-t'])
            effective = self.effective()
            if any(effective.get(k.lower()) != v for k, v in POLICY.items()):
                raise RuntimeError('SSH Include precedence prevents the requested policy')
            self.runner(['systemctl', 'reload', 'ssh.service'])
            defaults = self.path('etc/default/ufw')
            current = defaults.read_text()
            if not re.search(r'^IPV6=', current, re.M):
                raise RuntimeError('Missing IPv6 firewall configuration')
            defaults.write_text(re.sub(r'^IPV6=.*$', 'IPV6=yes', current, flags=re.M))
            self.runner(['ufw', 'default', 'deny', 'incoming'])
            self.runner(['ufw', 'default', 'allow', 'outgoing'])
            if 'ufw allow 443' in added.splitlines():
                # The inspected legacy rule included UDP; this server uses TCP TLS.
                self.runner(['ufw', '--force', 'delete', 'allow', '443'])
            for port in (22, 80, 443):
                self.runner(['ufw', 'allow', str(port) + '/tcp', 'comment', 'wgs-security'])
            self.runner(['ufw', '--force', 'enable'])
            return {'status': 'pending_second_ssh_confirmation', 'rollbackSeconds': 180, **self.verify()}
        except Exception:
            self.rollback()
            raise

    def confirm(self):
        state = self.load()
        if state['status'] != 'pending' or self.clock() - state['createdAt'] > 150:
            raise RuntimeError('Confirmation window closed')
        verification = self.verify()
        # Caller must establish a new SSH connection and externally verify HTTPS
        # before invoking this command; an existing connection is insufficient.
        self.runner(['systemctl', 'stop', UNIT + '.timer'])
        state.update(status='confirmed', confirmedAt=self.clock())
        self.save(state)
        return {'status': 'confirmed', **verification}

    def rollback(self):
        state = self.load()
        if state['status'] != 'pending':
            return {'status': state['status']}
        for name, metadata in state['files'].items():
            if name not in FILES:
                raise RuntimeError('Unknown rollback file')
            target = self.path(name)
            if metadata['exists']:
                shutil.copy2(self.state / 'before' / name, target)
                target.chmod(metadata['mode'])
            else:
                target.unlink(missing_ok=True)
        self.runner(['sshd', '-t'])
        self.runner(['systemctl', 'reload', 'ssh.service'])
        self.runner(['ufw', '--force', 'enable' if state['ufwWasActive'] else 'disable'])
        state.update(status='rolled_back', rolledBackAt=self.clock())
        self.save(state)
        return {'status': 'rolled_back'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['apply', 'confirm', 'rollback', 'status'])
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        parser.error('Run with sudo on the approved Ubuntu server')
    os.umask(0o077)
    policy = HostPolicy()
    if STATE.is_symlink() or (STATE.exists() and STATE.stat().st_uid != 0):
        raise RuntimeError('State must be owned by root')
    result = policy.load() if args.operation == 'status' else getattr(policy, args.operation)()
    print(json.dumps(result))


if __name__ == '__main__':
    main()
