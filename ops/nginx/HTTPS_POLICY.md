# HTTPS 보안 헤더 적용

운영 Express는 신뢰한 Nginx의 HTTPS 요청에만 `Strict-Transport-Security: max-age=300`을 보낸다. HTTP 응답과 개발 서버에는 보내지 않는다. Nginx는 기존 HTTP→HTTPS 전환과 `X-Forwarded-Proto $scheme` 전달을 유지한다.

첫 배포에서는 5분만 적용한다. 인증서 만료일, 갱신 타이머, 두 운영 도메인의 HTTPS 접속, 앱 WebView를 확인한 후 관찰 기간을 두고 운영자가 `WGS_HSTS_MAX_AGE_SECONDS=86400`으로 하루, 이어 `604800`으로 일주일을 선택할 수 있다. 이 작업은 자동으로 적용 기간을 늘리지 않는다. `includeSubDomains`와 `preload`는 사용하지 않는다.

되돌려야 할 때도 HTTPS를 유지한 채 `WGS_HSTS_MAX_AGE_SECONDS=0`으로 응답한다. 이미 적용한 브라우저가 다시 접속해야 설정이 지워진다. 인증서를 먼저 끄거나 HTTP로만 되돌리는 복구는 사용하지 않는다.

근거: [MDN Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security). 운영 헤더 확인과 인증서 갱신 설정 확인은 배포 검증에 별도로 기록한다.
