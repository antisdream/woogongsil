import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ============================================================
// 개발 서버 프록시
// ------------------------------------------------------------
// 이 프록시는 localhost:5173에서 `npm.cmd run dev`를 실행할 때만 사용합니다.
// API, Socket.IO, 실기 이미지 요청을 localhost:5000 Express 백엔드로 보내
// 게이트키퍼, 로그인, API 호출이
// 백엔드 로직 변경 없이 Vite 개발 서버에서 동작하게 합니다.
// ============================================================
export default defineConfig({
    plugins: [react()],

    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
            },
            '/socket.io': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                ws: true,
            },
            '/ipep-img': {
                target: 'http://localhost:5000',
                changeOrigin: true,
            },
        },
    },

    // ============================================================
    // 빌드 청크 경고 기준
    // ------------------------------------------------------------
    // 우공실은 시험, 게시판, 관리자,
    // 회식맵, 멀티플레이 화면을 포함하는 단일 SPA라 기본 번들이 커질 수 있습니다.
    // 기존 로직을 바꾸지 않고 빌드 경고 기준만 유지합니다.
    // ============================================================
    build: {
        chunkSizeWarningLimit: 1000,
    },
});
