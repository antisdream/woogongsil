'use strict';

function registerLegalRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const legalConsentService = options.legalConsentService;
    const validateRealtimeSession = options.validateRealtimeSession;
    if (!app || typeof app.get !== 'function' || !pool || !legalConsentService || typeof validateRealtimeSession !== 'function') {
        throw new Error('registerLegalRoutes requires app, pool, legalConsentService, and validateRealtimeSession.');
    }

    async function requireUserSession(req, res) {
        const auth = await validateRealtimeSession(req);
        if (auth?.valid && auth?.user) return auth;
        res.status(401).json({
            success: false,
            valid: false,
            reason: auth?.reason || 'session_expired',
            msg: '유효한 로그인 세션이 필요합니다.',
        });
        return null;
    }

    function sendLegalError(res, error, fallbackCode, fallbackMessage) {
        const status = Number(error?.status || 500);
        if (status >= 500) console.error(`[${fallbackCode}]`, error);
        return res.status(status).json({
            success: false,
            code: error?.code || fallbackCode,
            msg: status >= 500 ? fallbackMessage : error.message,
        });
    }

    app.get('/api/legal/documents', async (req, res) => {
        try {
            const context = String(req.query?.context || '').trim().toLowerCase();
            const documents = await legalConsentService.getActiveDocuments(context);
            return res.json({ success: true, context, documents });
        } catch (error) {
            const status = Number(error?.status || 500);
            if (status >= 500) console.error('[legal documents] error', error);
            return res.status(status).json({
                success: false,
                code: error?.code || 'LEGAL_DOCUMENTS_FAILED',
                msg: status >= 500 ? '동의 문서를 불러오지 못했습니다.' : error.message,
            });
        }
    });

    app.post('/api/legal/user-status', async (req, res) => {
        const auth = await requireUserSession(req, res);
        if (!auth) return;
        try {
            const status = await legalConsentService.getUserEvidenceStatus(auth.user.id);
            return res.json({
                success: true,
                required: !status.complete,
                status,
            });
        } catch (error) {
            return sendLegalError(res, error, 'LEGAL_USER_STATUS_FAILED', '회원 동의 상태를 확인하지 못했습니다.');
        }
    });

    app.post('/api/legal/user-acceptance', async (req, res) => {
        const auth = await requireUserSession(req, res);
        if (!auth) return;

        try {
            const validation = await legalConsentService.validateAcceptanceBundle(
                req.body?.legal,
                'signup',
                { requireAge14: true }
            );
            const currentStatus = await legalConsentService.getUserEvidenceStatus(auth.user.id);
            if (currentStatus.complete) {
                return res.json({ success: true, required: false, status: currentStatus });
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                await connection.query('SELECT id FROM wgs_users WHERE id = ? FOR UPDATE', [auth.user.id]);
                const lockedStatus = await legalConsentService.getUserEvidenceStatus(auth.user.id, connection);
                if (!lockedStatus.complete) {
                    await legalConsentService.insertAcceptanceEvents(connection, {
                        userId: auth.user.id,
                        age14Confirmed: validation.age14Confirmed,
                        acceptedDocuments: validation.acceptedDocuments,
                    });
                }
                await connection.commit();
            } catch (transactionError) {
                try { await connection.rollback(); } catch {}
                throw transactionError;
            } finally {
                connection.release();
            }

            const savedStatus = await legalConsentService.getUserEvidenceStatus(auth.user.id);
            return res.json({ success: true, required: !savedStatus.complete, status: savedStatus });
        } catch (error) {
            return sendLegalError(res, error, 'LEGAL_USER_ACCEPTANCE_FAILED', '회원 동의 내용을 저장하지 못했습니다.');
        }
    });
}

module.exports = registerLegalRoutes;
