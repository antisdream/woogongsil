const express = require('express');
const path = require('path');

function registerIpepFeature({ app, pool, backendDir }) {
    // 정보처리기사 실기 API 연결 블록
    // ----------------------------------------------------------
    // 이 블록은 실기 API만 추가합니다.
    // 기존 필기 API는 수정하지 않습니다.
    // 이 블록에서 오류가 나도 기본 필기 사이트는 계속 동작합니다.
    try {
        const createIpepRouter = require('../ipepRoutes');

        // 관리자 페이지가 사용하는 공개 URL 규칙은 유지하면서 자산은
        // backend/public 안에 보관해 백엔드 묶음으로 배포할 수 있게 합니다.
        const writtenImageDir = path.join(backendDir, 'public', 'question_image');
        app.use('/question_image', express.static(writtenImageDir));

        const ipepImageDir = path.join(backendDir, 'public', 'ipep-img');

        // 실기 문제은행 이미지 정적 경로입니다.
        app.use('/ipep-img/random', express.static(path.join(ipepImageDir, 'random')));

        // 실기 문제은행 이미지 정적 경로입니다.
        app.use('/ipep-img/past', express.static(path.join(ipepImageDir, 'past')));

        // 실기 3주 공략 보기 이미지 정적 경로입니다.
        app.use('/ipep-img/three-week', express.static(path.join(ipepImageDir, 'three-week')));

        // 실기 API 라우트를 연결합니다.
        app.use('/api/ipep', createIpepRouter(pool));

        console.log('OK: IPEP API mounted at /api/ipep');
    } catch (ipepRouteError) {
        console.error('WARN: IPEP API mount failed:', ipepRouteError.message);
        console.error('WARN: Main written-exam site will continue running.');
    }
}

module.exports = { registerIpepFeature };
