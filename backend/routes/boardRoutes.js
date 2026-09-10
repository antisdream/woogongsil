// 게시글과 댓글 API를 제공합니다.
'use strict';

const { normalizeBoardContentJson } = require('../services/boardContentService');
const { parseBoardType, storedBoardType, BoardPolicyError } = require('../services/boardPolicyService');
const { createBoardUploadHandler } = require('../services/boardUploadService');

function registerBoardRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const backendDir = options.backendDir;
    const getPostWithChildren = options.getPostWithChildren;
    const refreshPostLikeCount = options.refreshPostLikeCount;
    const getBoardDateString = options.getBoardDateString;
    const sendNoticePostEmailsInBackground = options.sendNoticePostEmailsInBackground;
    const getUserById = options.getUserById;
    const sendEmail = options.sendEmail;
    const validateRealtimeSession = options.validateRealtimeSession;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerBoardRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerBoardRoutes requires a MySQL pool.');
    }
    if (typeof validateRealtimeSession !== 'function') {
        throw new Error('registerBoardRoutes requires validateRealtimeSession.');
    }

    // Only middleware-verified OTP sessions on the dedicated admin cookie path authorize moderation.
    function hasBoardAdminAuthority(req) {
        return req.path.startsWith('/api/admin/board/') && req.adminAuth?.valid === true
            && req.adminAuth.isPrimaryAdmin === true;
    }

    function authUserId(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    function authUserName(auth) {
        return String(auth?.user?.name || auth?.user?.nickname || authUserId(auth)).trim();
    }

    async function requireSessionUser(req, res, expectedId = '') {
        const administrativePath = req.path.startsWith('/api/admin/board/');
        const auth = administrativePath
            ? (hasBoardAdminAuthority(req) ? req.adminAuth : { valid: false, reason: 'admin_email_otp_required' })
            : await validateRealtimeSession(req);
        if (!auth.valid) {
            res.status(401).json({
                success: false,
                valid: false,
                reason: auth.reason || 'session_expired',
                msg: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
            });
            return null;
        }

        const requesterId = authUserId(auth);
        const targetId = String(expectedId || requesterId || '').trim();
        if (!requesterId || !targetId || requesterId !== targetId) {
            res.status(403).json({
                success: false,
                valid: false,
                reason: 'forbidden_user_mismatch',
                msg: '본인 계정으로만 처리할 수 있습니다.',
            });
            return null;
        }

        return auth;
    }

app.post('/api/posts/upload-file', createBoardUploadHandler({ backendDir, requireSessionUser, uploadBucket: 'board' }));

// 12. 게시판 API
app.get('/api/posts', async (req, res) => {
    try {
        const [postRows] = await pool.query(
            // 공지글은 관리자가 저장한 noticeOrder 기준으로 먼저 정렬합니다.
            // 일반 게시글은 최신 작성글이 위에 오도록 정렬합니다.
            `SELECT id
             FROM wgs_posts
             ORDER BY
                isNotice DESC,
                CASE WHEN isNotice = 1 THEN COALESCE(noticeOrder, 999999999) ELSE 999999999 END ASC,
                CAST(id AS UNSIGNED) DESC,
                id DESC`
        );

        const posts = [];

        for (const row of postRows) {
            const post = await getPostWithChildren(row.id);
            if (post) posts.push(post);
        }

        return res.json(posts);
    } catch (error) {
        console.error('게시글 목록 조회 오류:', error);
        return res.status(500).json({ success: false, msg: '게시글 불러오기 오류' });
    }
});

app.post(['/api/posts', '/api/admin/board/posts'], async (req, res) => {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    let contentJson = null;

    try {
        contentJson = normalizeBoardContentJson(req.body.contentJson);
    } catch (error) {
        return res.status(400).json({ success: false, msg: '게시글 에디터 데이터 형식이 올바르지 않습니다.' });
    }

    const auth = await requireSessionUser(req, res, req.body.authorId || req.body.userId || req.body.id);
    if (!auth) return;

    const authorId = authUserId(auth);
    const authorName = authUserName(auth);

    let boardType;
    try { boardType = parseBoardType(req.body.boardType); }
    catch (error) { return res.status(error.status).json({ success: false, msg: error.message }); }
    if (boardType === 'notice' && !(hasBoardAdminAuthority(req))) {
        return res.status(403).json({ success: false, msg: '공지게시판 글은 관리자만 작성할 수 있습니다.' });
    }

    const id = Date.now().toString();

    if (!title || !content || !authorId) {
        return res.status(400).json({ success: false, msg: '제목, 내용, 작성자 정보가 필요합니다.' });
    }

    try {
        // 게시판 소속은 서버 필드, 상단 고정은 isNotice로 각각 유지합니다.
        await pool.query(
            `INSERT INTO wgs_posts (id, title, content, contentJson, authorId, authorName, date, boardType, views, likes, isNotice)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
            [id, title, content, contentJson, authorId, authorName || authorId, getBoardDateString(), boardType]
        );

        // 최고관리자가 공지게시판에 새 글을 작성한 경우에만 전체 회원에게 공지 메일을 예약합니다.
        // - 게시글 저장 성공 후 실행하므로 메일 서버 문제 때문에 게시글 작성 자체가 실패하지 않습니다.
        // - await 하지 않고 백그라운드로 보내서 사용자가 글쓰기 완료 응답을 오래 기다리지 않게 합니다.
        const authorIsPrimaryAdmin = hasBoardAdminAuthority(req);
        const shouldSendNoticeEmail = authorIsPrimaryAdmin && boardType === 'notice';

        if (shouldSendNoticeEmail) {
            sendNoticePostEmailsInBackground({ authorId, postId: id, title }).catch(error => {
                console.error('[공지메일] 백그라운드 발송 오류:', error.message);
            });
        }

        return res.json({
            success: true,
            msg: '게시글이 등록되었습니다.',
            noticeEmailQueued: shouldSendNoticeEmail
        });
    } catch (error) {
        console.error('게시글 등록 오류:', error);
        return res.status(500).json({ success: false, msg: '서버 오류 발생' });
    }
});

app.put(['/api/posts/notice', '/api/admin/board/posts/notice'], async (req, res) => {
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);
    const postIds = Array.isArray(req.body.postIds) ? req.body.postIds : [];
    const isNotice = req.body.isNotice ? 1 : 0;

    if (!(hasBoardAdminAuthority(req))) return res.status(403).json({ success: false, msg: '관리자만 접근 가능합니다.' });

    try {
        // 공지 등록 시 noticeOrder를 함께 부여합니다.
        // - 기존 공지 순서는 유지하고, 새로 공지 등록되는 글은 공지 목록의 맨 아래에 붙입니다.
        // - 공지 해제 시에는 noticeOrder를 NULL로 비워 재등록 시 새 순서를 받을 수 있게 합니다.
        let nextNoticeOrder = 1;
        if (isNotice) {
            const [orderRows] = await pool.query('SELECT COALESCE(MAX(noticeOrder), 0) + 1 AS nextOrder FROM wgs_posts WHERE isNotice = 1');
            nextNoticeOrder = Number(orderRows[0]?.nextOrder || 1);
        }

        for (const postId of postIds) {
            if (isNotice) {
                await pool.query(
                    'UPDATE wgs_posts SET isNotice = 1, noticeOrder = COALESCE(noticeOrder, ?) WHERE id = ?',
                    [nextNoticeOrder, postId]
                );
                nextNoticeOrder += 1;
            } else {
                await pool.query(
                    'UPDATE wgs_posts SET isNotice = 0, noticeOrder = NULL WHERE id = ?',
                    [postId]
                );
            }
        }

        return res.json({ success: true, msg: isNotice ? '공지사항을 등록하였습니다.' : '공지사항이 해제 되었습니다.' });
    } catch (error) {
        console.error('공지 업데이트 오류:', error);
        return res.status(500).json({ success: false, msg: '공지사항 업데이트 오류' });
    }
});

// 관리자 공지 노출 순서 저장 API
// - Board.jsx의 '공지 순서' 버튼에서 보낸 orderedPostIds 순서대로 noticeOrder를 재부여합니다.
// - 기존 게시글/댓글/추천 로직은 변경하지 않고 공지 정렬값만 수정합니다.
app.put(['/api/posts/notice-order', '/api/admin/board/posts/notice-order'], async (req, res) => {
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);
    const orderedPostIds = Array.isArray(req.body.orderedPostIds) ? req.body.orderedPostIds.map(id => String(id)) : [];

    if (!(hasBoardAdminAuthority(req))) return res.status(403).json({ success: false, msg: '관리자만 접근 가능합니다.' });
    if (orderedPostIds.length === 0) return res.status(400).json({ success: false, msg: '저장할 공지 순서가 없습니다.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (let i = 0; i < orderedPostIds.length; i += 1) {
            await connection.query(
                'UPDATE wgs_posts SET noticeOrder = ? WHERE id = ? AND isNotice = 1',
                [i + 1, orderedPostIds[i]]
            );
        }

        await connection.commit();
        return res.json({ success: true, msg: '공지 순서가 저장되었습니다.' });
    } catch (error) {
        await connection.rollback();
        console.error('공지 순서 저장 오류:', error);
        return res.status(500).json({ success: false, msg: '공지 순서 저장 오류' });
    } finally {
        connection.release();
    }
});

app.put(['/api/posts/:postId', '/api/admin/board/posts/:postId'], async (req, res) => {
    const postId = String(req.params.postId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const hasContentJson = Object.prototype.hasOwnProperty.call(req.body || {}, 'contentJson');
    let contentJson = null;

    if (hasContentJson) {
        try {
            contentJson = normalizeBoardContentJson(req.body.contentJson);
        } catch (error) {
            return res.status(400).json({ success: false, msg: '게시글 에디터 데이터 형식이 올바르지 않습니다.' });
        }
    }

    try {
        const [rows] = await pool.query('SELECT * FROM wgs_posts WHERE id = ?', [postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '게시글을 찾을 수 없습니다.' });

        const post = rows[0];
        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        const nextBoardType = parseBoardType(req.body.boardType, storedBoardType(post));
        if (!isPrimaryAdmin && (storedBoardType(post) === 'notice' || nextBoardType !== storedBoardType(post))) {
            return res.status(403).json({ success: false, msg: '게시판 이동과 공지 관리는 관리자만 할 수 있습니다.' });
        }
        if (post.authorId !== userId && !isPrimaryAdmin) {
            return res.status(403).json({ success: false, msg: '수정 권한이 없습니다.' });
        }

        if (hasContentJson) {
            await pool.query('UPDATE wgs_posts SET title = ?, content = ?, contentJson = ?, boardType = ? WHERE id = ?', [title, content, contentJson, nextBoardType, postId]);
        } else {
            await pool.query('UPDATE wgs_posts SET title = ?, content = ?, boardType = ? WHERE id = ?', [title, content, nextBoardType, postId]);
        }

        const updatedPost = await getPostWithChildren(postId);
        return res.json({ success: true, post: updatedPost });
    } catch (error) {
        if (error instanceof BoardPolicyError) return res.status(error.status).json({ success: false, msg: error.message });
        console.error('게시글 수정 오류:', error);
        return res.status(500).json({ success: false, msg: '게시글 수정 중 오류가 발생했습니다.' });
    }
});

app.delete(['/api/posts/:id', '/api/admin/board/posts/:id'], async (req, res) => {
    const postId = String(req.params.id || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);

    try {
        const [rows] = await pool.query('SELECT * FROM wgs_posts WHERE id = ?', [postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '게시글을 찾을 수 없습니다.' });

        const post = rows[0];
        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        if (storedBoardType(post) === 'notice' && !isPrimaryAdmin) return res.status(403).json({ success: false, msg: '공지 관리는 관리자만 할 수 있습니다.' });
        if (post.authorId !== userId && !isPrimaryAdmin) {
            return res.status(403).json({ success: false, msg: '삭제 권한이 없습니다.' });
        }

        await pool.query('DELETE FROM wgs_posts WHERE id = ?', [postId]);

        return res.json({ success: true, msg: '게시글이 삭제되었습니다.' });
    } catch (error) {
        console.error('게시글 삭제 오류:', error);
        return res.status(500).json({ success: false, msg: '서버 오류' });
    }
});

app.post('/api/posts/:postId/view', async (req, res) => {
    const postId = String(req.params.postId || '').trim();

    try {
        await pool.query('UPDATE wgs_posts SET views = COALESCE(views, 0) + 1 WHERE id = ?', [postId]);
        const [rows] = await pool.query('SELECT views FROM wgs_posts WHERE id = ?', [postId]);

        if (rows.length === 0) return res.status(404).json({ success: false, msg: '게시글을 찾을 수 없습니다.' });

        return res.json({ success: true, views: rows[0].views });
    } catch (error) {
        console.error('조회수 증가 오류:', error);
        return res.status(500).json({ success: false, msg: '조회수 처리 중 오류가 발생했습니다.' });
    }
});

app.post('/api/posts/:postId/like', async (req, res) => {
    const postId = String(req.params.postId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);

    if (!userId) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

    try {
        const [postRows] = await pool.query('SELECT id FROM wgs_posts WHERE id = ?', [postId]);
        if (postRows.length === 0) return res.status(404).json({ success: false, msg: '게시글을 찾을 수 없습니다.' });

        const [likeRows] = await pool.query('SELECT postId FROM wgs_post_likes WHERE postId = ? AND userId = ?', [postId, userId]);

        if (likeRows.length === 0) {
            await pool.query('INSERT IGNORE INTO wgs_post_likes (postId, userId) VALUES (?, ?)', [postId, userId]);
        } else {
            await pool.query('DELETE FROM wgs_post_likes WHERE postId = ? AND userId = ?', [postId, userId]);
        }

        const likeInfo = await refreshPostLikeCount(postId);

        return res.json({ success: true, likes: likeInfo.likes, likedUsers: likeInfo.likedUsers });
    } catch (error) {
        console.error('좋아요 처리 오류:', error);
        return res.status(500).json({ success: false, msg: '추천 처리 실패' });
    }
});

app.post('/api/posts/:id/comments', async (req, res) => {
    const postId = String(req.params.id || '').trim();
    const text = String(req.body.text || '').trim();
    const auth = await requireSessionUser(req, res, req.body.authorId || req.body.userId || req.body.id);
    if (!auth) return;

    const authorId = authUserId(auth);
    const authorName = authUserName(auth);
    const id = Date.now().toString();

    if (!text) return res.status(400).json({ success: false, msg: '댓글을 입력해주세요.' });

    try {
        const [postRows] = await pool.query('SELECT id FROM wgs_posts WHERE id = ?', [postId]);
        if (postRows.length === 0) return res.status(404).json({ success: false, msg: '게시글을 찾을 수 없습니다.' });

        await pool.query(
            `INSERT INTO wgs_comments (id, postId, text, authorId, authorName, date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, postId, text, authorId, authorName || authorId, getBoardDateString()]
        );

        return res.json({ success: true, msg: '댓글이 등록되었습니다.' });
    } catch (error) {
        console.error('댓글 등록 오류:', error);
        return res.status(500).json({ success: false, msg: '댓글 등록 오류' });
    }
});

app.put(['/api/posts/:postId/comments/:commentId', '/api/admin/board/posts/:postId/comments/:commentId'], async (req, res) => {
    const commentId = String(req.params.commentId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);
    const text = String(req.body.text || '').trim();

    try {
        const [rows] = await pool.query('SELECT * FROM wgs_comments WHERE id = ? AND postId = ?', [commentId, req.params.postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '댓글을 찾을 수 없습니다.' });

        const comment = rows[0];
        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        if (comment.authorId !== userId && !isPrimaryAdmin) return res.status(403).json({ success: false, msg: '수정 권한이 없습니다.' });

        await pool.query('UPDATE wgs_comments SET text = ? WHERE id = ?', [text, commentId]);

        return res.json({ success: true });
    } catch (error) {
        console.error('댓글 수정 오류:', error);
        return res.status(500).json({ success: false, msg: '댓글 수정 중 오류가 발생했습니다.' });
    }
});

app.delete(['/api/posts/:postId/comments/:commentId', '/api/admin/board/posts/:postId/comments/:commentId'], async (req, res) => {
    const commentId = String(req.params.commentId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);

    try {
        const [rows] = await pool.query('SELECT * FROM wgs_comments WHERE id = ? AND postId = ?', [commentId, req.params.postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '댓글을 찾을 수 없습니다.' });

        const comment = rows[0];
        const [replies] = await pool.query('SELECT id FROM wgs_replies WHERE commentId = ? LIMIT 1', [commentId]);
        const hasReplies = replies.length >0;

        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        if (hasReplies && !isPrimaryAdmin) {
            return res.status(403).json({ success: false, msg: '대댓글이 달린 댓글은 관리자만 삭제할 수 있습니다.' });
        }

        if (comment.authorId !== userId && !isPrimaryAdmin) {
            return res.status(403).json({ success: false, msg: '삭제 권한이 없습니다.' });
        }

        const deletedText = isPrimaryAdmin ? '관리자가 삭제한 댓글입니다.' : '작성자가 삭제한 댓글입니다.';
        await pool.query('UPDATE wgs_comments SET text = ? WHERE id = ?', [deletedText, commentId]);

        return res.json({ success: true, msg: '댓글이 삭제처리 되었습니다.' });
    } catch (error) {
        console.error('댓글 삭제 오류:', error);
        return res.status(500).json({ success: false, msg: '댓글 삭제 오류' });
    }
});

app.post('/api/posts/:postId/comments/:commentId/replies', async (req, res) => {
    const commentId = String(req.params.commentId || '').trim();
    const text = String(req.body.text || '').trim();
    const auth = await requireSessionUser(req, res, req.body.authorId || req.body.userId || req.body.id);
    if (!auth) return;

    const authorId = authUserId(auth);
    const authorName = authUserName(auth);
    const id = Date.now().toString();

    if (!text) return res.status(400).json({ success: false, msg: '답글을 입력해주세요.' });

    try {
        const [commentRows] = await pool.query('SELECT id FROM wgs_comments WHERE id = ? AND postId = ?', [commentId, req.params.postId]);
        if (commentRows.length === 0) return res.status(404).json({ success: false, msg: '댓글을 찾을 수 없습니다.' });

        await pool.query(
            `INSERT INTO wgs_replies (id, commentId, text, authorId, authorName, date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, commentId, text, authorId, authorName || authorId, getBoardDateString()]
        );

        return res.json({ success: true, msg: '답글이 등록되었습니다.' });
    } catch (error) {
        console.error('답글 등록 오류:', error);
        return res.status(500).json({ success: false, msg: '답글 등록 오류' });
    }
});

app.put(['/api/posts/:postId/comments/:commentId/replies/:replyId', '/api/admin/board/posts/:postId/comments/:commentId/replies/:replyId'], async (req, res) => {
    const replyId = String(req.params.replyId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);
    const text = String(req.body.text || '').trim();

    try {
        const [rows] = await pool.query('SELECT r.* FROM wgs_replies r JOIN wgs_comments c ON c.id = r.commentId WHERE r.id = ? AND r.commentId = ? AND c.postId = ?', [replyId, req.params.commentId, req.params.postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '답글을 찾을 수 없습니다.' });

        const reply = rows[0];
        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        if (reply.authorId !== userId && !isPrimaryAdmin) return res.status(403).json({ success: false, msg: '수정 권한이 없습니다.' });

        await pool.query('UPDATE wgs_replies SET text = ? WHERE id = ?', [text, replyId]);

        return res.json({ success: true });
    } catch (error) {
        console.error('답글 수정 오류:', error);
        return res.status(500).json({ success: false, msg: '답글 수정 중 오류가 발생했습니다.' });
    }
});

app.delete(['/api/posts/:postId/comments/:commentId/replies/:replyId', '/api/admin/board/posts/:postId/comments/:commentId/replies/:replyId'], async (req, res) => {
    const replyId = String(req.params.replyId || '').trim();
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
    if (!auth) return;

    const userId = authUserId(auth);

    try {
        const [rows] = await pool.query('SELECT r.* FROM wgs_replies r JOIN wgs_comments c ON c.id = r.commentId WHERE r.id = ? AND r.commentId = ? AND c.postId = ?', [replyId, req.params.commentId, req.params.postId]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: '답글을 찾을 수 없습니다.' });

        const reply = rows[0];
        const isPrimaryAdmin = hasBoardAdminAuthority(req);
        if (reply.authorId !== userId && !isPrimaryAdmin) return res.status(403).json({ success: false, msg: '삭제 권한이 없습니다.' });

        const deletedText = isPrimaryAdmin ? '관리자가 삭제한 답글입니다.' : '작성자가 삭제한 답글입니다.';
        await pool.query('UPDATE wgs_replies SET text = ? WHERE id = ?', [deletedText, replyId]);

        return res.json({ success: true, msg: '답글이 삭제처리 되었습니다.' });
    } catch (error) {
        console.error('답글 삭제 오류:', error);
        return res.status(500).json({ success: false, msg: '답글 삭제 오류' });
    }
});

app.post('/api/posts/notify-email', async (req, res) => {
    const auth = await requireSessionUser(req, res, req.body.userId || req.body.id || req.body.actionUserId);
    if (!auth) return;

    const targetUserId = String(req.body.targetUserId || '').trim();
    const targetUserName = req.body.targetUserName || '회원';
    const actionUserName = authUserName(auth) || req.body.actionUserName || '누군가';
    const type = req.body.type;

    try {
        const targetUser = await getUserById(targetUserId);
        if (!targetUser || !targetUser.email) return res.status(400).json({ success: false, msg: '수신자의 이메일을 찾을 수 없습니다.' });

        let subject = '';
        let text = '';

        if (type === 'like') {
            subject = `[알림] ${actionUserName}님이 게시글에 좋아요를 눌렀습니다.`;
            text = `[ SKN_우공실]\n${actionUserName}님이 ${targetUserName}님의 게시글에 좋아요를 누르셨습니다.\n홈페이지 바로가기 : www.ugongsil.kro.kr`;
        } else if (type === 'comment') {
            subject = `[알림] ${actionUserName}님이 게시글에 댓글을 남겼습니다.`;
            text = `[ SKN_우공실]\n${actionUserName}님이 ${targetUserName}님의 게시글에 댓글을 남기셨습니다.\n홈페이지 바로가기 : www.ugongsil.kro.kr`;
        } else {
            return res.status(400).json({ success: false, msg: '알 수 없는 알림 유형입니다.' });
        }

        const result = await sendEmail(targetUser.email, subject, text);
        if (!result.success) return res.status(500).json({ success: false, msg: '이메일 전송 실패' });

        return res.json({ success: true });
    } catch (error) {
        console.error('게시판 알림 메일 오류:', error);
        return res.status(500).json({ success: false, msg: '이메일 전송 실패' });
    }
});
}

module.exports = registerBoardRoutes;
