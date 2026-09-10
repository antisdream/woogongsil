'use strict';

const { PURPOSES, MemberVerificationError } = require('../../services/memberEmailVerificationService');

function registerMemberEmailVerificationRoutes({ app, memberVerificationService, getUserById, getUserByEmail, validateRealtimeSession }) {
    const service = memberVerificationService;
    const send = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            service.assertOrigin(req);
            const purpose = String(req.body.type || '');
            const email = String(req.body.email || '').trim().toLowerCase();
            if (!PURPOSES.has(purpose) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new MemberVerificationError('invalid_verification_request', '이메일과 인증 목적을 확인해주세요.');
            }
            let user;
            if (purpose === 'change-pw') {
                const session = await validateRealtimeSession(req);
                if (!session?.valid) throw new MemberVerificationError('member_login_required', '로그인 후 다시 진행해주세요.', 401);
                user = session.user;
            } else if (purpose === 'find-pw') {
                user = await getUserById(String(req.body.id || '').trim());
            } else {
                user = await getUserByEmail(email);
            }
            if ((purpose === 'signup' && user) || (purpose !== 'signup' && (!user || String(user.email || '').trim().toLowerCase() !== email))) {
                throw new MemberVerificationError('verification_account_mismatch', '입력한 회원 정보와 이메일을 확인해주세요.');
            }
            if (purpose === 'find-id' && String(req.body.name || '').trim() !== user.name) {
                throw new MemberVerificationError('verification_account_mismatch', '입력한 회원 정보와 이메일을 확인해주세요.');
            }
            return res.json(await service.issue(req, res, { email, purpose, user }));
        } catch (error) { return service.respondError(res, error); }
    };
    const verify = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            return res.json(await service.verify(req, { purpose: req.body.type, email: req.body.email, code: req.body.code }));
        } catch (error) { return service.respondError(res, error); }
    };
    // Old URLs use the same proof and purpose checks; ambiguous old purposes are rejected.
    for (const path of ['/api/auth/send-code', '/api/send-verification']) app.post(path, send);
    for (const path of ['/api/auth/verify-code', '/api/verify-code']) app.post(path, verify);
}

module.exports = registerMemberEmailVerificationRoutes;
