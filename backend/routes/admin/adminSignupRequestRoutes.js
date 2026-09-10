'use strict';
const { runtimeLog: wgsRuntimeLog } = require("../../services/runtimeLog");


const { createLegalConsentService } = require('../../services/legalConsentService');

function registerAdminSignupRequestRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;
    const ensureAdminUserControlSchema = options.ensureAdminUserControlSchema;
    const sendEmail = options.sendEmail;
    const writeAdminOperationLog = options.writeAdminOperationLog;
    const ADMIN_USER_ID = options.adminUserId;
    let legalConsentService = options.legalConsentService || null;
    const getLegalConsentService = () => {
        if (!legalConsentService) legalConsentService = createLegalConsentService({ pool });
        return legalConsentService;
    };

    const missing = Object.entries({ app, pool, validateAdminSession, ensureAdminUserControlSchema, sendEmail, writeAdminOperationLog, ADMIN_USER_ID })
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAdminSignupRequestRoutes missing dependencies: ${missing.join(', ')}`);
    }

    async function ensureSignupApprovalSchema() {
        await getLegalConsentService().ensureSchema();
    }

    function normalizeSignupRequestStatus(value) {
        const status = String(value || '').trim().toUpperCase();
        return ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? status : 'PENDING';
    }

    function buildSignupApprovalMailText(request) {
        const siteUrl = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://woogongsil.site').replace(/\/$/, '');
        return [
            `안녕하세요, ${request.name || request.login_id}님.`,
            '',
            '우공실 회원가입이 승인되었습니다.',
            `아이디: ${request.login_id}`,
            '',
            `로그인 페이지: ${siteUrl}/login`,
            '',
            '- SKN_우공실',
        ].join('\n');
    }

    function buildSignupRejectMailText(request, reason) {
        return [
            `안녕하세요, ${request.name || request.login_id}님.`,
            '',
            '우공실 회원가입 신청이 거절되었습니다.',
            '',
            `거절 사유: ${reason}`,
            '',
            '내용을 확인하신 뒤 필요한 경우 관리자에게 문의해주세요.',
            '',
            '- SKN_우공실',
        ].join('\n');
    }

    async function getSignupRequestStats() {
        await ensureSignupApprovalSchema();
        const [rows] = await pool.query(
            `SELECT status, COUNT(*) AS count
             FROM wgs_signup_requests
             GROUP BY status`
        );
        return rows.reduce((acc, row) => {
            acc[String(row.status || '').toLowerCase()] = Number(row.count || 0);
            return acc;
        }, { pending: 0, approved: 0, rejected: 0 });
    }


    app.get('/api/admin/signup-requests', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid || !auth.isPrimaryAdmin) {
                return res.status(403).json({ success: false, message: '최고 관리자만 회원가입 승인 목록을 확인할 수 있습니다.' });
            }

            await ensureSignupApprovalSchema();
            await getLegalConsentService().purgeExpiredRecords();
            const requestedStatus = String(req.query?.status || 'PENDING').trim().toUpperCase();
            const keyword = String(req.query?.search || '').trim();
            const params = [];
            const where = [];

            if (requestedStatus && requestedStatus !== 'ALL') {
                where.push('status = ?');
                params.push(normalizeSignupRequestStatus(requestedStatus));
            }

            if (keyword) {
                where.push('(login_id LIKE ? OR name LIKE ? OR email LIKE ?)');
                const like = `%${keyword}%`;
                params.push(like, like, like);
            }

            const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const [rows] = await pool.query(
                `SELECT r.id, r.login_id AS loginId, r.name, r.email, r.status,
                        DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s') AS requestedAt,
                        r.reviewed_by AS reviewedBy,
                        DATE_FORMAT(r.reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewedAt,
                        r.review_note AS reviewNote,
                        DATE_FORMAT(r.retention_until, '%Y-%m-%d %H:%i:%s') AS retentionUntil,
                        DATE_FORMAT(r.personal_data_purged_at, '%Y-%m-%d %H:%i:%s') AS personalDataPurgedAt,
                        (SELECT COUNT(DISTINCT d.document_code)
                           FROM wgs_legal_acceptance_events e
                           INNER JOIN wgs_legal_documents d ON d.id = e.document_id
                          WHERE e.signup_request_id = r.id
                            AND e.event_type = 'ACCEPTED'
                            AND e.age_14_confirmed = 1
                            AND d.is_active = 1
                            AND d.document_code IN ('TERMS', 'SIGNUP_PRIVACY')
                            AND e.document_version = d.version
                            AND e.document_sha256 = d.content_sha256) AS legalAcceptedCount
                 FROM wgs_signup_requests r
                 ${whereClause}
                 ORDER BY r.requested_at DESC, r.id DESC
                 LIMIT 1000`,
                params
            );
            const stats = await getSignupRequestStats();

            return res.json({
                success: true,
                isPrimaryAdmin: true,
                requests: rows.map((row) => ({
                    ...row,
                    legalEvidenceComplete: Number(row.legalAcceptedCount || 0) === 2,
                    legalAcceptedCount: Number(row.legalAcceptedCount || 0),
                })),
                stats,
            });
        } catch (error) {
            wgsRuntimeLog("error", "routes/admin/adminSignupRequestRoutes.js:140", '[admin signup requests list] error', error);
            return res.status(500).json({ success: false, message: '회원가입 승인 목록 조회 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/admin/signup-requests/:requestId/approve', async (req, res) => {
        const conn = await pool.getConnection();
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid || !auth.isPrimaryAdmin) {
                return res.status(403).json({ success: false, message: '최고 관리자만 회원가입을 승인할 수 있습니다.' });
            }

            await ensureAdminUserControlSchema();
            await ensureSignupApprovalSchema();
            const requestId = Number(req.params.requestId);
            if (!Number.isFinite(requestId) || requestId <= 0) {
                return res.status(400).json({ success: false, message: '승인할 가입 요청을 확인할 수 없습니다.' });
            }

            await conn.beginTransaction();
            const [rows] = await conn.query('SELECT * FROM wgs_signup_requests WHERE id = ? LIMIT 1 FOR UPDATE', [requestId]);
            const request = rows?.[0];
            if (!request) {
                await conn.rollback();
                return res.status(404).json({ success: false, message: '회원가입 요청을 찾을 수 없습니다.' });
            }
            if (request.status !== 'PENDING') {
                await conn.rollback();
                return res.status(400).json({ success: false, message: '이미 처리된 회원가입 요청입니다.' });
            }
            const consentService = getLegalConsentService();
            const evidence = await consentService.getSignupEvidenceStatus(conn, requestId);
            if (!evidence.complete) {
                await conn.rollback();
                return res.status(409).json({
                    success: false,
                    message: '최신 이용약관·개인정보 동의 및 만 14세 이상 확인 증적이 없어 승인할 수 없습니다. 신청자가 새 가입 절차로 다시 신청해야 합니다.',
                });
            }
            if (!request.password_hash) {
                await conn.rollback();
                return res.status(409).json({ success: false, message: '가입신청의 임시 비밀번호 정보가 없어 승인할 수 없습니다.' });
            }

            const [duplicateRows] = await conn.query(
                'SELECT id, email FROM wgs_users WHERE id = ? OR LOWER(email) = ? LIMIT 1',
                [request.login_id, String(request.email || '').trim().toLowerCase()]
            );
            if (duplicateRows.length) {
                await conn.rollback();
                return res.status(409).json({ success: false, message: '같은 아이디 또는 이메일의 회원이 이미 존재합니다.' });
            }

            await conn.query(
                'INSERT INTO wgs_users (id, password, name, email, sessionToken) VALUES (?, ?, ?, ?, NULL)',
                [request.login_id, request.password_hash, request.name, request.email]
            );
            await consentService.linkSignupAcceptancesToUser(conn, requestId, request.login_id);
            await conn.query(
                `UPDATE wgs_signup_requests
                 SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW(), review_note = NULL,
                     approved_user_id = ?, password_hash = NULL, request_ip = NULL, user_agent = NULL,
                     retention_until = DATE_ADD(NOW(), INTERVAL ${consentService.signupRetentionDays} DAY)
                 WHERE id = ?`,
                [auth.user?.id || ADMIN_USER_ID, request.login_id, requestId]
            );
            await conn.commit();

            const mailResult = await sendEmail(
                request.email,
                '[SKN_우공실] 회원가입이 승인되었습니다',
                buildSignupApprovalMailText(request)
            );
            if (mailResult?.success === false) {
                wgsRuntimeLog("warn", "routes/admin/adminSignupRequestRoutes.js:215", '[signup approval] approval email failed:', mailResult.error?.message || mailResult.error);
            }

            await writeAdminOperationLog({
                operationType: 'signup',
                action: 'approve',
                title: '회원가입 승인',
                message: `${request.login_id} 계정을 승인했습니다.`,
                actor: { id: auth.user?.id || ADMIN_USER_ID, name: auth.user?.name || auth.user?.id || ADMIN_USER_ID },
                payload: { requestId, loginId: request.login_id, email: request.email },
            });

            return res.json({
                success: true,
                mailSuccess: mailResult?.success !== false,
                message: mailResult?.success === false
                    ? '회원가입을 승인했지만 승인 메일 발송은 실패했습니다.'
                    : '회원가입을 승인하고 승인 메일을 발송했습니다.',
            });
        } catch (error) {
            try { await conn.rollback(); } catch {}
            wgsRuntimeLog("error", "routes/admin/adminSignupRequestRoutes.js:236", '[admin signup approve] error', error);
            return res.status(500).json({ success: false, message: '회원가입 승인 처리 중 오류가 발생했습니다.' });
        } finally {
            conn.release();
        }
    });

    app.post('/api/admin/signup-requests/:requestId/reject', async (req, res) => {
        const conn = await pool.getConnection();
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid || !auth.isPrimaryAdmin) {
                return res.status(403).json({ success: false, message: '최고 관리자만 회원가입을 거절할 수 있습니다.' });
            }

            await ensureSignupApprovalSchema();
            const requestId = Number(req.params.requestId);
            const reason = String(req.body?.reason || '').trim();
            if (!Number.isFinite(requestId) || requestId <= 0) {
                return res.status(400).json({ success: false, message: '거절할 가입 요청을 확인할 수 없습니다.' });
            }
            if (!reason) {
                return res.status(400).json({ success: false, message: '거절 사유를 입력해주세요.' });
            }

            await conn.beginTransaction();
            const [rows] = await conn.query('SELECT * FROM wgs_signup_requests WHERE id = ? LIMIT 1 FOR UPDATE', [requestId]);
            const request = rows?.[0];
            if (!request) {
                await conn.rollback();
                return res.status(404).json({ success: false, message: '회원가입 요청을 찾을 수 없습니다.' });
            }
            if (request.status !== 'PENDING') {
                await conn.rollback();
                return res.status(400).json({ success: false, message: '이미 처리된 회원가입 요청입니다.' });
            }

            await conn.query(
                `UPDATE wgs_signup_requests
                 SET status = 'REJECTED', reviewed_by = ?, reviewed_at = NOW(), review_note = ?,
                     password_hash = NULL, request_ip = NULL, user_agent = NULL,
                     retention_until = DATE_ADD(NOW(), INTERVAL ${getLegalConsentService().signupRetentionDays} DAY)
                 WHERE id = ?`,
                [auth.user?.id || ADMIN_USER_ID, reason, requestId]
            );
            await getLegalConsentService().markSignupEvidenceForRetention(conn, requestId);
            await conn.commit();

            const mailResult = await sendEmail(
                request.email,
                '[SKN_우공실] 회원가입 신청이 거절되었습니다',
                buildSignupRejectMailText(request, reason)
            );
            if (mailResult?.success === false) {
                wgsRuntimeLog("warn", "routes/admin/adminSignupRequestRoutes.js:290", '[signup approval] reject email failed:', mailResult.error?.message || mailResult.error);
            }

            await writeAdminOperationLog({
                operationType: 'signup',
                action: 'reject',
                title: '회원가입 거절',
                message: `${request.login_id} 계정을 거절했습니다.`,
                actor: { id: auth.user?.id || ADMIN_USER_ID, name: auth.user?.name || auth.user?.id || ADMIN_USER_ID },
                payload: { requestId, loginId: request.login_id, email: request.email, reason },
            });

            return res.json({
                success: true,
                mailSuccess: mailResult?.success !== false,
                message: mailResult?.success === false
                    ? '회원가입을 거절했지만 거절 메일 발송은 실패했습니다.'
                    : '회원가입을 거절하고 거절 사유 메일을 발송했습니다.',
            });
        } catch (error) {
            try { await conn.rollback(); } catch {}
            wgsRuntimeLog("error", "routes/admin/adminSignupRequestRoutes.js:311", '[admin signup reject] error', error);
            return res.status(500).json({ success: false, message: '회원가입 거절 처리 중 오류가 발생했습니다.' });
        } finally {
            conn.release();
        }
    });


}

module.exports = registerAdminSignupRequestRoutes;
