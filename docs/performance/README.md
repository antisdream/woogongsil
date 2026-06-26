# 성능 검증 문서

이 문서는 우공실 서비스의 Docker 기반 부하 테스트 기록을 GitHub 저장소에서 확인할 수 있도록 정리한 운영 문서입니다. 원문 블로그에는 상세 과정과 이미지가 포함되어 있고, 저장소에는 배포 판단에 필요한 요약, 확인 항목, 추적 링크를 남깁니다.

## 문서화 기준

- 원문을 그대로 복제하지 않고 테스트 목적, 검증 범위, 운영 활용 기준을 요약합니다.
- 계정, DB 접속 정보, 비밀키, 원본 로그처럼 운영 민감값이 될 수 있는 내용은 저장소에 포함하지 않습니다.
- 각 테스트는 별도 문서로 관리해 회차별 목적과 확인 항목을 추적할 수 있게 합니다.
- AWS Lightsail 반영 전에는 이 문서와 실제 서버 검증 결과를 함께 확인합니다.

## 테스트 도구 저장소

성능 테스트 실행 환경과 k6, Prometheus, Grafana 설정은 별도 저장소에서 관리합니다.

- [antisdream/woogongsil-loadtest-lab](https://github.com/antisdream/woogongsil-loadtest-lab)

## 테스트 기록

| 순서 | 게시일 | 원문 제목 | 저장소 문서 | 원문 |
| --- | --- | --- | --- | --- |
| 1차 | 2026-05-31 15:19 | SKN_우공실 성능 테스트 [1] | [docker-load-test-01.md](./docker-load-test-01.md) | [Naver Blog](https://blog.naver.com/andisdream/224301694314) |
| 2차 | 2026-06-03 20:10 | SKN_우공실 성능 테스트 [2] | [docker-load-test-02.md](./docker-load-test-02.md) | [Naver Blog](https://blog.naver.com/andisdream/224304996395) |
| 3차 | 2026-06-07 14:58 | SKN_우공실 성능 테스트 [3] | [docker-load-test-03.md](./docker-load-test-03.md) | [Naver Blog](https://blog.naver.com/andisdream/224308514804) |

## 배포 전 활용 기준

Docker 부하 테스트 기록은 배포 가능 여부를 단독으로 결정하는 자료가 아니라, 코드 검증과 운영 서버 확인을 보완하는 자료입니다. 저장소 공개 또는 Lightsail 반영 전에는 다음 항목을 함께 확인합니다.

- 백엔드 정적 검증: `cd backend && npm run check`
- 프론트엔드 정적 검증: `cd frontend && npm run lint`
- 프론트엔드 빌드 검증: `cd frontend && npm run build`
- 백엔드 실행 검증: `cd backend && node server.js`
- 관리자 페이지 CRUD, 문제 풀이, 게시판, 회식맵, 실시간 기능의 주요 동선 확인
- 부하 테스트에서 확인한 병목이 최근 코드 변경으로 다시 발생하지 않는지 확인

## 향후 보강 항목

성능 검증 기록의 신뢰도를 높이려면 각 회차별로 아래 값을 정리해두는 것이 좋습니다.

- 테스트 환경: CPU, 메모리, 운영체제, Docker 버전, Node.js 버전
- 테스트 조건: 동시 접속 수, 요청 수, 지속 시간, 시나리오
- 측정 지표: 평균 응답 시간, 상위 백분위 응답 시간, 실패율, CPU와 메모리 사용률
- 병목 원인: DB 연결, API 라우트, 정적 파일 처리, Socket.IO 연결, 프론트엔드 렌더링
- 조치 결과: 코드 변경, 설정 변경, 배포 환경 변경, 재테스트 결과
