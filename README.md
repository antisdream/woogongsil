# 우공실 학습 플랫폼

우공실은 정보처리기사 필기와 실기 학습 흐름을 한 곳에서 운영하기 위한 웹 기반 학습 플랫폼입니다. 문제 풀이, 오답 관리, 랭킹, 게시판, 실시간 소통, 회식맵, 관리자 운영 기능을 하나의 서비스 경험으로 묶어 학습자와 운영자가 같은 데이터 기준에서 움직일 수 있도록 구성했습니다.

이 저장소는 개발 환경 검증과 AWS Lightsail 배포를 함께 고려합니다. 운영 데이터와 비밀 설정은 저장소에 포함하지 않고, 애플리케이션 코드와 배포 가능한 정적 자산만 공개 대상으로 관리합니다.

## 서비스 접속

- 운영 URL: https://woogongsil.site
- 최초 접속 환경에서는 게이트키퍼 인증코드 입력 후 서비스를 이용할 수 있습니다.

## 서비스 범위

- 정보처리기사 필기 문제은행, 기출문제, 오답노트
- 정보처리기사 실기 문제은행, 기출문제, 주관식 채점 흐름
- 멀티플레이 CBT 방 생성, 응시, 결과 확인, 오답 정리
- 회원가입, 로그인, 이메일 인증, 세션 관리
- 게시판, 공지, 댓글, 추천, 공지 순서 관리
- 홈 화면 달력, 랭킹, 실시간 접속자, 채팅
- 회식맵 장소 제보, 댓글, 좋아요, 수정 요청, 관리자 검토
- 관리자 페이지 기반 사용자, 문제, 화면 설정, 일정, 공지, 결재 관리

## 운영 구조

우공실은 React/Vite 기반 프론트엔드와 Express/MySQL 기반 백엔드로 구성됩니다. 프론트엔드는 사용자 화면과 관리자 화면을 제공하고, 백엔드는 인증, 문제 데이터, 게시판, 랭킹, 회식맵, 멀티플레이, 운영 설정 API를 담당합니다.

관리자 페이지의 주요 변경 작업은 DB와 연결된 CRUD 흐름을 기준으로 동작합니다. 따라서 화면 설정, 문제/해설 수정, 사용자 관리, 회식맵 승인 같은 운영성 기능은 프론트엔드 컴포넌트와 백엔드 라우트가 함께 유지되어야 합니다.

## 기술 스택

### 프론트엔드

![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=000)
![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=fff)
![React Router](https://img.shields.io/badge/React_Router-7.14-CA4245?logo=reactrouter&logoColor=fff)
![Axios](https://img.shields.io/badge/Axios-1.15-5A29E4?logo=axios&logoColor=fff)
![Socket.IO Client](https://img.shields.io/badge/Socket.IO_Client-4.8-010101?logo=socketdotio&logoColor=fff)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.2-06B6D4?logo=tailwindcss&logoColor=fff)
![ESLint](https://img.shields.io/badge/ESLint-9.39-4B32C3?logo=eslint&logoColor=fff)

- React와 React DOM을 기반으로 사용자 페이지, 관리자 페이지, 시험 화면, 회식맵 화면을 구성합니다.
- Vite를 사용해 개발 서버, 프로덕션 빌드, 정적 자산 번들링을 처리합니다.
- React Router로 페이지 라우팅을 관리하고, Axios로 백엔드 API와 통신합니다.
- Socket.IO Client로 실시간 접속자, 채팅, 멀티플레이 흐름을 연결합니다.
- Tailwind CSS, 전역 CSS, 도메인별 CSS 파일을 함께 사용해 화면 스타일을 관리합니다.
- ESLint로 프론트엔드 코드 품질과 Hook 사용 규칙을 검증합니다.

### 백엔드

![Node.js](https://img.shields.io/badge/Node.js-Runtime-339933?logo=nodedotjs&logoColor=fff)
![Express](https://img.shields.io/badge/Express-5.2-000000?logo=express&logoColor=fff)
![MySQL](https://img.shields.io/badge/MySQL-8.x-4479A1?logo=mysql&logoColor=fff)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?logo=socketdotio&logoColor=fff)
![Nodemailer](https://img.shields.io/badge/Nodemailer-Mail-22B573)
![bcrypt](https://img.shields.io/badge/bcrypt-Password_Security-2F855A)
![dotenv](https://img.shields.io/badge/dotenv-Environment-2E7D32)
![CSV](https://img.shields.io/badge/CSV_Parser-Data_Import-FFB000)

- Node.js와 Express를 기반으로 인증, 시험, 게시판, 랭킹, 회식맵, 관리자 API를 제공합니다.
- MySQL2 연결 풀을 사용해 운영 DB와 연동하고, 관리자 페이지 CRUD 흐름을 처리합니다.
- Socket.IO로 멀티플레이 시험, 실시간 접속자, 채팅 관련 서버 이벤트를 관리합니다.
- Nodemailer로 회원가입, 계정 찾기, 오류 신고 등 메일 발송 기능을 처리합니다.
- bcrypt로 비밀번호 해시를 관리하고, dotenv 기반 환경변수로 운영 민감값을 분리합니다.
- csv-parser와 csv-parse 기반 스크립트로 필기/실기 문제 데이터 적재와 보정 작업을 지원합니다.

### 배포 및 검증

![AWS Lightsail](https://img.shields.io/badge/AWS_Lightsail-Deployment-FF9900?logo=amazonaws&logoColor=fff)
![Docker](https://img.shields.io/badge/Docker-Load_Test-2496ED?logo=docker&logoColor=fff)
![npm](https://img.shields.io/badge/npm-Scripts-CB3837?logo=npm&logoColor=fff)

- AWS Lightsail 배포를 기준으로 로컬 검증, 환경변수 관리, 서버 실행 흐름을 맞춥니다.
- Docker 기반 부하 테스트 기록을 운영 전 성능 검증 자료로 관리합니다.
- `npm run check`, `npm run lint`, `npm run build`를 배포 전 기본 검증 절차로 사용합니다.

## 프로젝트 구성

```text
ExamAppProject/
├─ backend/              # Express, MySQL, Socket.IO, 관리자/시험/게시판 API
│  ├─ config/            # 환경변수와 DB 연결 설정
│  ├─ middleware/        # 입장 인증, hCaptcha, 요청 제한
│  ├─ routes/            # 기능별 API 라우트
│  ├─ services/          # 서버 런타임 상태와 공통 저장소
│  └─ scripts/           # 데이터 적재와 유지보수 스크립트
├─ frontend/             # React/Vite 사용자 화면과 관리자 화면
│  ├─ public/            # 정적 자산과 안전 보정 스크립트
│  └─ src/
│     ├─ components/     # 공통 UI 컴포넌트
│     ├─ features/       # 도메인별 기능 모듈
│     ├─ pages/          # 라우트 페이지
│     └─ styles/         # 전역/관리자/회식맵 스타일
├─ docs/
│  └─ performance/       # Docker 부하 테스트와 성능 검증 기록
├─ PATCH_NOTES.md        # 서비스 변경 이력
└─ README.md             # 프로젝트 안내
```

## 주요 설정

환경변수는 `backend/.env`에서 관리합니다. 이 파일에는 DB 접속 정보, 메일 앱 비밀번호, hCaptcha 비밀키, 초대 코드, 카카오 API 키처럼 운영 민감값이 들어가므로 GitHub에 올리지 않습니다.

공유용 예시는 `backend/.env.example`, `backend/.env.mealmap.kakao.example`, `frontend/.env.local.mealmap.kakao.example`에만 둡니다. 실제 운영값은 AWS Lightsail 또는 로컬 서버의 환경 설정으로 별도 관리합니다.

## 실행 요약

백엔드:

```bash
cd backend
npm install
npm run check
node server.js
```

프론트엔드:

```bash
cd frontend
npm install
npm run lint
npm run build
```

로컬 개발 서버가 필요할 때는 프론트엔드에서 `npm run dev`를 실행하고, API는 Vite 프록시를 통해 `localhost:5000` 백엔드로 전달합니다.

## 배포 기준

AWS Lightsail 배포 시에는 프론트엔드 빌드 결과와 백엔드 서버가 함께 동작해야 합니다. 운영 환경에서는 다음 기준을 지킵니다.

- `.env`, DB 백업, 로그, 런타임 JSON 저장소는 저장소에 포함하지 않습니다.
- `backend/node_modules`, `frontend/node_modules`, `frontend/dist`는 GitHub에 올리지 않습니다.
- 서버 실행 전 `backend/.env` 값을 운영 환경에 맞게 설정합니다.
- 배포 전 `backend npm run check`, `frontend npm run lint`, `frontend npm run build`를 통과시킵니다.
- 관리자 페이지의 CRUD 흐름은 DB 스키마와 함께 확인합니다.
- 성능 관련 변경은 Docker 부하 테스트 기록을 참고해 배포 전 확인 항목을 재점검합니다.

## 저장소 공개 전 확인

이 저장소는 개인 운영값이 포함되지 않은 상태로 공개하는 것을 전제로 합니다. 공개 전에는 `git status`, `.gitignore`, `.env` 제외 여부, 대용량 파일 여부를 다시 확인해야 합니다.

## 운영 문서

- [PATCH_NOTES.md](./PATCH_NOTES.md): 게시판 공지와 운영 기능 반영 기록을 기준으로 정리한 서비스 변경 이력
- [docs/performance/README.md](./docs/performance/README.md): Docker 부하 테스트와 성능 검증 기록
- [backend/.env.example](./backend/.env.example): 백엔드 운영 환경변수 예시
- [backend/.env.mealmap.kakao.example](./backend/.env.mealmap.kakao.example): 회식맵 카카오 API 백엔드 설정 예시
- [frontend/.env.local.mealmap.kakao.example](./frontend/.env.local.mealmap.kakao.example): 회식맵 카카오 API 프론트엔드 설정 예시
