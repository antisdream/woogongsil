#!/usr/bin/env python3
"""Apply only WGS nginx/log rotation settings and preserve the TLS configuration."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SITE = 'etc/nginx/sites-available/woogongsil'
TARGETS = (SITE, 'etc/nginx/conf.d/wgs-security-zones.conf', 'etc/nginx/conf.d/wgs-security-log.conf',
           'etc/nginx/snippets/wgs-security-rate.conf', 'etc/logrotate.d/wgs-security-runtime',
           'etc/systemd/system/wgs-runtime-logrotate.service', 'etc/systemd/system/wgs-runtime-logrotate.timer')
BEGIN, END = '# WGS SECURITY BEGIN', '# WGS SECURITY END'


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45, env={**os.environ, 'LC_ALL': 'C'})
    if result.returncode:
        raise RuntimeError('Edge command failed: ' + args[0])
    return result.stdout.strip()


def server_blocks(source):
    """Scan nginx delimiters without treating quoted JSON/comments as blocks."""
    depth, start, quote, escaped, comment = 0, None, None, False, False
    for index, character in enumerate(source):
        if comment:
            if character == '\n': comment = False
            continue
        if escaped:
            escaped = False
            continue
        if character == '\\':
            escaped = True
            continue
        if quote:
            if character == quote: quote = None
            continue
        if character in ('"', "'"):
            quote = character
            continue
        if character == '#':
            comment = True
            continue
        if character == '{':
            if depth == 0 and re.search(r'\bserver\s*$', source[:index]): start = index
            depth += 1
        elif character == '}':
            depth -= 1
            if depth < 0: raise RuntimeError('Unbalanced nginx source')
            if depth == 0 and start is not None:
                yield start, index
                start = None
    if depth or quote: raise RuntimeError('Incomplete nginx source')


def configured_site(source):
    clean = re.sub(r'[ \t]*' + re.escape(BEGIN) + r'.*?' + re.escape(END) + r'[ \t]*(?:\r?\n)*', '', source, flags=re.S)
    edits, secure = [], 0
    for start, end in server_blocks(clean):
        block = clean[start + 1:end]
        names = re.findall(r'\bserver_name\s+([^;]+);', block)
        if not any('woogongsil.site' in name.split() for name in names): continue
        if re.search(r'^\s*(access_log|error_log)\s', block, re.M):
            raise RuntimeError('An existing site log policy requires review')
        https = bool(re.search(r'\blisten\s+[^;]*\b443\b[^;]*\bssl\b', block))
        secure += int(https)
        lines = [BEGIN, 'access_log /var/log/wgs-security/nginx-access.log wgs_security;', 'error_log /dev/null crit;']
        if https: lines.append('include /etc/nginx/snippets/wgs-security-rate.conf;')
        lines.append(END)
        edits.append((start + 1, end, '\n    ' + '\n    '.join(lines) + '\n' + block.lstrip('\r\n')))
    if secure != 1 or len(edits) != 2:
        raise RuntimeError('Expected the reviewed WGS HTTPS and HTTP redirect blocks')
    for offset, end, text in reversed(edits): clean = clean[:offset] + text + clean[end:]
    return clean


class EdgeConfiguration:
    def __init__(self, app, backup, root=Path('/'), runner=run):
        self.app, self.backup, self.root, self.runner = app, backup, root, runner

    def target(self, name):
        path = self.root / name
        if path.is_symlink() or not path.resolve().is_relative_to(self.root.resolve()):
            raise RuntimeError('Redirected edge configuration')
        return path

    def prepare(self):
        if self.backup.exists(): raise RuntimeError('Edge backup already exists')
        self.backup.mkdir(parents=True, mode=0o700)
        self.backup.chmod(0o700)
        state = {'files': {}, 'timerExisted': False}
        for name in TARGETS:
            source = self.target(name)
            state['files'][name] = {'exists': source.exists(), 'mode': source.stat().st_mode & 0o777 if source.exists() else None}
            if source.exists():
                target = self.backup / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        state['timerExisted'] = state['files']['etc/systemd/system/wgs-runtime-logrotate.timer']['exists']
        (self.backup / 'state.json').write_text(json.dumps(state))
        # Validate the exact source shape before the application is stopped.
        configured_site(self.target(SITE).read_text())
        return {'prepared': True}

    def write(self, name, text):
        target = self.target(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.wgs-tmp')
        if temporary.is_symlink(): raise RuntimeError('Redirected temporary edge file')
        temporary.write_text(text, encoding='utf-8')
        temporary.chmod(0o644)
        temporary.replace(target)

    def apply(self, phase):
        if phase not in ['dry-run', 'enforced']: raise RuntimeError('Invalid rate phase')
        if not (self.backup / 'state.json').is_file(): raise RuntimeError('Backup is required')
        config = self.app / 'ops/nginx'
        self.write('etc/nginx/conf.d/wgs-security-zones.conf', (config / 'wgs-rate-zones.conf').read_text())
        self.write('etc/nginx/conf.d/wgs-security-log.conf', (config / 'wgs-log-format.conf').read_text())
        rate = (config / 'wgs-rate-server.conf').read_text()
        if phase == 'dry-run': rate = rate.replace('limit_req_dry_run off;', 'limit_req_dry_run on;')
        self.write('etc/nginx/snippets/wgs-security-rate.conf', rate)
        self.write(SITE, configured_site(self.target(SITE).read_text()))
        directory = self.target('var/log/wgs-security')
        directory.mkdir(parents=True, exist_ok=True, mode=0o750)
        directory.chmod(0o750)
        self.write('etc/logrotate.d/wgs-security-runtime', (self.app / 'ops/security/wgs-runtime-logrotate.conf').read_text())
        self.write('etc/systemd/system/wgs-runtime-logrotate.service', '[Unit]\nDescription=Bound WGS runtime log retention\n[Service]\nType=oneshot\nExecStart=/usr/sbin/logrotate --state /var/lib/wgs-security/logrotate.status /etc/logrotate.d/wgs-security-runtime\n')
        self.write('etc/systemd/system/wgs-runtime-logrotate.timer', '[Unit]\nDescription=Check WGS runtime log sizes each minute\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=1min\nAccuracySec=5s\nUnit=wgs-runtime-logrotate.service\n[Install]\nWantedBy=timers.target\n')
        state_directory = self.target('var/lib/wgs-security')
        state_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        state_directory.chmod(0o700)
        for name in ('wgs-backend-out.log', 'wgs-backend-error.log'):
            log = self.target('home/ubuntu/.pm2/logs/' + name)
            if log.exists(): log.chmod(0o600)
        self.runner(['nginx', '-t'])
        self.runner(['logrotate', '--debug', str(self.target('etc/logrotate.d/wgs-security-runtime'))])
        self.runner(['systemctl', 'daemon-reload'])
        self.runner(['systemctl', 'enable', '--now', 'wgs-runtime-logrotate.timer'])
        self.runner(['systemctl', 'reload', 'nginx'])
        return {'configured': True, 'phase': phase}

    def rollback(self):
        state = json.loads((self.backup / 'state.json').read_text())
        if not state['timerExisted'] and self.target('etc/systemd/system/wgs-runtime-logrotate.timer').exists():
            self.runner(['systemctl', 'disable', '--now', 'wgs-runtime-logrotate.timer'])
        for name, metadata in state['files'].items():
            if name not in TARGETS: raise RuntimeError('Unknown edge rollback file')
            target = self.target(name)
            if metadata['exists']:
                shutil.copy2(self.backup / name, target)
                target.chmod(metadata['mode'])
            else: target.unlink(missing_ok=True)
        self.runner(['nginx', '-t'])
        self.runner(['systemctl', 'daemon-reload'])
        if state['timerExisted']: self.runner(['systemctl', 'restart', 'wgs-runtime-logrotate.timer'])
        self.runner(['systemctl', 'reload', 'nginx'])
        return {'restored': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['prepare', 'apply', 'rollback'])
    parser.add_argument('--app-root', type=Path, required=True)
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--phase', choices=['dry-run', 'enforced'], default='dry-run')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0: parser.error('Root access on the approved Ubuntu server is required')
    if args.app_root != Path('/home/ubuntu/wgs_deploy/ExamAppProject') or not args.backup_dir.resolve().is_relative_to(Path('/home/ubuntu/wgs_deploy/github-releases')) or args.backup_dir.name != 'edge': parser.error('Unexpected configuration paths')
    os.umask(0o077)
    config = EdgeConfiguration(args.app_root, args.backup_dir)
    print(json.dumps(config.apply(args.phase) if args.operation == 'apply' else getattr(config, args.operation)()))


if __name__ == '__main__':
    main()
