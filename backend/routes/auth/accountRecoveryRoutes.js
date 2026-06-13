// 계정 조회와 비밀번호 재설정 API를 제공합니다.
'use strict';

function registerAccountRecoveryRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const bcrypt = options.bcrypt;
    const requireHcaptcha = options.requireHcaptcha;
    const getUserById = options.getUserById;
    const getUserByEmail = options.getUserByEmail;
    const verificationCodes = options.verificationCodes;
    const SALT_ROUNDS = options.saltRounds;

    const required = { app, pool, bcrypt, requireHcaptcha, getUserById, getUserByEmail, verificationCodes, SALT_ROUNDS };
    const missing = Object.entries(required).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAccountRecoveryRoutes missing dependencies: ${missing.join(', ')}`);
    }

    app.post('/api/find-id', async (req, res) => {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();

        const record = verificationCodes[email];
        if (!record || !record.verified) {
            return res.status(400).json({ success: false, msg: '이메일 인증이 완료되지 않았습니다.' });
        }

        try {
            const [rows] = await pool.query(
                'SELECT id FROM wgs_users WHERE name = ? AND LOWER(email) = ?',
                [name, email]
            );

            if (rows.length === 0) {
                return res.status(400).json({ success: false, msg: '입력하신 이름과 이메일에 일치하는 계정이 없습니다.' });
            }

            delete verificationCodes[email];
            return res.json({ success: true, id: rows[0].id });
        } catch (error) {
            console.error('아이디 찾기 오류:', error);
            return res.status(500).json({ success: false, msg: '아이디 찾기 중 서버 오류가 발생했습니다.' });
        }
    });

    app.post('/api/find-pw/reset', async (req, res) => {
        if (!(await requireHcaptcha(req, res, 'find_reset'))) return;

        const id = String(req.body.id || '').trim();
        const newPassword = String(req.body.newPassword || '');

        try {
            const user = await getUserById(id);
            if (!user) return res.status(404).json({ success: false, msg: '계정을 찾을 수 없습니다.' });

            const email = String(user.email || '').trim().toLowerCase();
            const record = verificationCodes[email];

            if (!record || !record.verified) {
                return res.status(400).json({ success: false, msg: '이메일 인증이 완료되지 않았습니다.' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

            await pool.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', [hashedPassword, id]);

            delete verificationCodes[email];

            return res.json({ success: true, msg: '비밀번호가 성공적으로 변경되었습니다.' });
        } catch (error) {
            console.error('비밀번호 재설정 오류:', error);
            return res.status(500).json({ success: false, msg: '비밀번호 변경 실패' });
        }
    });

    // 예전 API명 호환용.
    app.post('/api/reset-pw', async (req, res) => {
        const email = String(req.body.email || '').trim().toLowerCase();
        const newPassword = String(req.body.newPassword || '');

        try {
            const user = await getUserByEmail(email);
            if (!user) return res.status(404).json({ success: false, msg: '계정을 찾을 수 없습니다.' });

            const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            await pool.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', [hashedPassword, user.id]);

            return res.json({ success: true });
        } catch (error) {
            console.error('구버전 비밀번호 재설정 오류:', error);
            return res.status(500).json({ success: false, msg: '비밀번호 변경 실패' });
        }
    });

    app.post('/api/user/change-pw', async (req, res) => {
        if (!(await requireHcaptcha(req, res, 'change_pw'))) return;

        const id = String(req.body.id || '').trim();
        const newPw = String(req.body.newPw || '');

        try {
            const user = await getUserById(id);
            if (!user) return res.status(404).json({ success: false, msg: '사용자를 찾을 수 없습니다.' });

            const email = String(user.email || '').trim().toLowerCase();
            const record = verificationCodes[email];

            if (!record || !record.verified) {
                return res.status(400).json({ success: false, msg: '이메일 인증이 완료되지 않았습니다.' });
            }

            const hashedPassword = await bcrypt.hash(newPw, SALT_ROUNDS);

            await pool.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', [hashedPassword, id]);

            delete verificationCodes[email];

            return res.json({ success: true, msg: '비밀번호가 안전하게 변경되었습니다. 다시 로그인해주세요.' });
        } catch (error) {
            console.error('마이페이지 비밀번호 변경 오류:', error);
            return res.status(500).json({ success: false, msg: '비밀번호 변경 처리 중 오류 발생' });
        }
    });


}

module.exports = registerAccountRecoveryRoutes;
