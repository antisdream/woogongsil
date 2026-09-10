# 운영 출처와 개발 출처

`NODE_ENV=production`에서는 기본 운영 출처 `https://woogongsil.site`, `https://www.woogongsil.site`만 허용한다. 스킴·호스트·포트 전체가 일치해야 한다. HTTP, `null`, 임의 서브도메인, 로컬·사설 IP는 허용하지 않는다. 추가 운영 도메인이 필요하면 승인한 HTTPS 출처만 `CORS_ALLOWED_ORIGINS`에 지정한다. 경로나 와일드카드는 사용할 수 없다.

개발 환경의 localhost·사설 LAN 예외는 운영에서 적용되지 않는다. 개발에서도 `WGS_ALLOW_PRIVATE_DEV_ORIGINS=false`로 자동 LAN 허용을 끌 수 있다. 휴대폰 로컬 개발에는 개발 서버의 Origin 설정을 별도로 사용한다.

동일한 출처 검사로 HTTP CORS와 Socket.IO의 polling·WebSocket 연결을 제한한다. 운영 CSP의 외부 통신 대상도 명시한 HTTPS/WSS 출처로 한정한다. Origin 없는 상태 점검과 네이티브 요청은 기존 경로를 사용하며, 회원·관리자 작업은 쿠키·CSRF 검사를 계속 통과해야 한다. CORS만으로 크롤러나 직접 API 호출을 차단하지는 않는다.

근거: [Socket.IO CORS와 allowRequest](https://socket.io/docs/v4/handling-cors/). 최종 배포에서는 두 운영 도메인의 페이지 로딩, 회원 로그인, 대결 연결·재연결, Android WebView를 확인한다.
