'use strict';

// Removed feature URLs must return JSON instead of the SPA fallback.
function registerRetiredFeatureRoutes({ app }) {
    const paths = [
        '/api/online-users',
        '/api/rankings',
        '/api/my-ranking-history',
        '/api/my-ranking-history-v2',
        '/api/admin/users/:userId/ranking-history',
        '/api/ipep-ranking',
        '/api/realtime-chat/list',
        '/api/realtime-chat/send',
    ];
    app.all(paths, (_req, res) => res.status(404).json({
        success: false,
        code: 'feature_removed',
        message: '종료된 기능입니다.',
    }));
}

module.exports = registerRetiredFeatureRoutes;
