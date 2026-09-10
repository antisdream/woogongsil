'use strict';

const { MemberVerificationError, assertPassword } = require('../../services/memberEmailVerificationService');

function registerAccountRecoveryRoutes({ app, bcrypt, memberVerificationService, memberSessionService, validateRealtimeSession, revokeAdminSessionsForUser, sendEmail, saltRounds }) {
    const service = memberVerificationService;

    app.post('/api/find-id', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const id = await service.consume(req, 'find-id', { email: req.body.email }, async (_db, state) => {
                if (state.user.name !== String(req.body.name || '').trim()) {
                    throw new MemberVerificationError('verification_account_mismatch', '입력한 회원 정보를 확인해주세요.');
                }
                return state.userId;
            });
            service.clearCookie(res);
            return res.json({ success: true, id });
        } catch (error) { return service.respondError(res, error); }
    });

    const changePassword = purpose => async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const userId = String(req.body.id || '').trim();
            const password = String(purpose === 'find-pw' ? req.body.newPassword || '' : req.body.newPw || '');
            assertPassword(password);
            let session;
            if (purpose === 'change-pw') {
                session = await validateRealtimeSession(req);
                if (!session?.valid || String(session.user.id) !== userId) {
                    throw new MemberVerificationError('member_login_required', '로그인 후 다시 진행해주세요.', 401);
                }
            }
            const email = await service.consume(req, purpose, { userId }, async (db, state) => {
                if (session) {
                    try { await memberSessionService.assertStillActive(session, db); }
                    catch (error) {
                        if (error.status === 401) throw new MemberVerificationError('member_login_required', '로그인이 변경되었습니다. 다시 진행해주세요.', 401);
                        throw error;
                    }
                }
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                await db.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', [hashedPassword, state.userId]);
                await revokeAdminSessionsForUser(state.userId, purpose === 'find-pw' ? 'password_reset' : 'password_changed', db);
                await memberSessionService.revokeAllForUser(state.userId, 'password_changed', db);
                return state.email;
            });
            service.clearCookie(res);
            memberSessionService.clearCookie(res);
            // Notification failure must not turn a committed password change into a retry.
            try {
                await sendEmail(email, '[우공실] 비밀번호 변경 안내',
                    '계정의 비밀번호가 변경되어 기존 로그인이 종료되었습니다. 새 비밀번호로 로그인해주세요.\n본인이 변경하지 않았다면 계정 복구를 진행하고 관리자에게 알려주세요.', { sensitive: true });
            } catch (_) { /* No password, address, code or SMTP error is logged. */ }
            return res.json({ success: true, msg: '비밀번호가 안전하게 변경되었습니다. 다시 로그인해주세요.' });
        } catch (error) { return service.respondError(res, error); }
    };

    app.post('/api/find-pw/reset', changePassword('find-pw'));
    app.post('/api/user/change-pw', changePassword('change-pw'));
    app.post('/api/reset-pw', (_req, res) => res.status(410).json({
        success: false, error: 'LEGACY_PASSWORD_RESET_DISABLED', msg: '지원이 종료된 비밀번호 재설정 경로입니다.',
    }));
}

module.exports = registerAccountRecoveryRoutes;
