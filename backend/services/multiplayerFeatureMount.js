const createMultiplayerRouter = require('../multiplayerRoutes');
const { attachMultiplayerSocket } = require('../multiplayerSocket');

function registerMultiplayerFeature({ app, pool, io }) {
    // 필기 기출문제 멀티플레이 API + Socket.IO 연결
    // ------------------------------------------------------------
    // 기존 필기/실기/게시판/FAQ API보다 독립된 /api/multiplayer 경로로만 추가합니다.
    // 기존 API 경로를 수정하지 않기 때문에 기존 기능과 충돌하지 않는다.
    try {
        const multiplayerRouter = createMultiplayerRouter({ pool, io });
        app.use('/api/multiplayer', multiplayerRouter);

        if (io) {
            attachMultiplayerSocket({ io, pool });
        }

        console.log('OK: written multiplayer API mounted at /api/multiplayer');
    } catch (multiplayerError) {
        console.error('WARN: written multiplayer API mount failed:', multiplayerError.message);
        console.error('WARN: Existing site will continue running without multiplayer API.');
    }
}

module.exports = { registerMultiplayerFeature };
