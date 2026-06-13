# 프론트엔드 안내

이 폴더는 우공실 학습 플랫폼의 React/Vite 프론트엔드입니다. 사용자 화면, 관리자 화면, 문제 풀이 화면, 회식맵, 실시간 패널, 멀티플레이 화면을 담당합니다.

전체 프로젝트 개요와 배포 기준은 상위 폴더의 [README.md](../README.md)를 기준으로 확인합니다.

## 실행

```bash
npm install
npm run dev
```

## 검증

```bash
npm run lint
npm run build
```

로컬 개발 서버에서 API 요청은 `vite.config.js`의 프록시 설정을 통해 백엔드 `localhost:5000`으로 전달됩니다.
