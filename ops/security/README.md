# 서버 접근 보완

`harden_host.py`는 기존 Ubuntu 호스트에만 적용한다. 인스턴스 변경, AWS 스냅샷 생성, 유료 방화벽 서비스 구매는 수행하지 않는다.

- UFW: IPv4·IPv6 수신 기본 거부, TCP 22·80·443 허용, 송신 허용. 앱 5000과 MySQL 3306·33060의 loopback 바인딩을 유지한다.
- SSH: 키 인증을 유지하고 비밀번호·대화형 인증·root 직접 로그인·X11·TCP·에이전트 전달·터널을 차단한다. 키 파일·authorized_keys·22번 포트·SFTP는 그대로 사용한다.
- 고정 관리 IP와 GitHub Actions 실행 IP 대역이 확정되어 있지 않으므로 22번을 임의의 현재 IP 한 곳으로 좁히지 않는다. 추후 고정 접속 경로를 마련하면 별도로 제한할 수 있다.
- 적용 전에 이전 설정을 root 전용 디렉터리에 보관하고 180초 후 자동 복구하는 systemd 타이머를 먼저 만든다. 새 SSH 연결과 외부 HTTPS 확인 후 150초 안에 `confirm`을 실행해야 설정이 유지된다.
- 예상하지 못한 기존 UFW 규칙이나 SSH 설정 우선순위가 있으면 적용을 중단한다. 기존 세션 하나가 살아 있다는 이유만으로 확인 완료 처리하지 않는다.

배포가 안정화된 뒤 기존 SSH 연결에서 `sudo python3 ops/security/harden_host.py apply`를 실행한다. 독립된 새 SSH 연결로 로그인과 공개 HTTPS를 확인한 후 같은 스크립트의 `confirm`을 실행한다. 실패하면 `rollback`을 실행하거나 타이머의 복구 결과를 확인한다. 로컬에서 파일 복원·명령 실패·타이머 선행·확인 기한을 검증하고, 실제 방화벽과 접속은 운영 적용 때 별도 확인한다.

이번 확인 시 로컬 및 서버에 AWS API 자격 증명은 설정되어 있지 않았다. Lightsail 콘솔 방화벽과 콘솔 복구 권한은 확인되지 않았다. 호스트 UFW·SSH 검증과 구분해 기록한다.

참고: [Ubuntu 방화벽 문서](https://ubuntu.com/server/docs/how-to/security/firewalls/), [OpenSSH 설정 설명](https://man.openbsd.org/sshd_config).
