'use strict';

const { parseBoardType } = require('../services/boardPolicyService');

function registerBoardReadRoutes({ app, pool, validateRealtimeSession, getPostWithChildren }) {
    const identity = auth => auth?.valid ? String(auth.user?.id || auth.id || '') : '';
    const paging = req => {
        const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(req.query.pageSize || req.query.limit) || 10)));
        const page = Math.min(100000, Math.max(1, Math.trunc(Number(req.query.page) || 1)));
        return { pageSize, offset: (page - 1) * pageSize };
    };
    const noStore = res => res.set('Cache-Control', 'private, no-store, max-age=0');
    const columns = `p.id,p.title,p.authorId,p.authorName,p.date,p.boardType,p.views,p.likes,p.isNotice,p.noticeOrder,
        (SELECT COUNT(*) FROM wgs_comments c WHERE c.postId=p.id) AS commentCount`;

    app.get('/api/posts', async (req, res) => {
        noStore(res);
        try {
            const viewerId = identity(await validateRealtimeSession(req));
            const { pageSize, offset } = paging(req);
            const where = [], params = [];
            if (!viewerId) where.push("p.boardType = 'notice'");
            if (req.query.boardType) { where.push('p.boardType = ?'); params.push(parseBoardType(req.query.boardType)); }
            if (req.query.scope === 'pinned') where.push('p.isNotice = 1');
            const query = String(req.query.q || '').trim().slice(0, 100);
            if (query) { where.push('(LOCATE(?,p.title)>0 OR LOCATE(?,p.content)>0)'); params.push(query, query); }
            const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
            const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM wgs_posts p ${filter}`, params);
            const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
            const [posts] = await pool.query(`SELECT ${columns} FROM wgs_posts p ${filter}
                ORDER BY p.isNotice DESC, CASE WHEN p.isNotice=1 THEN COALESCE(p.noticeOrder,999999999) ELSE 999999999 END,
                CAST(p.id AS UNSIGNED) ${sort},p.id ${sort} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
            res.set('X-Total-Count', String(total));
            return res.json(posts.map(post => ({ ...post, isNotice: Boolean(post.isNotice), comments: [] })));
        } catch (error) {
            return res.status(error.status || 500).json({ success: false, msg: error.status ? error.message : '게시글을 불러오지 못했습니다.' });
        }
    });

    app.get('/api/posts/my-activity', async (req, res) => {
        noStore(res);
        try {
            const viewerId = identity(await validateRealtimeSession(req));
            if (!viewerId) return res.status(401).json({ success: false, msg: '로그인이 필요합니다.' });
            const { pageSize, offset } = paging(req);
            const [[postCount]] = await pool.query('SELECT COUNT(*) AS total FROM wgs_posts WHERE authorId=?', [viewerId]);
            const commentSql = `SELECT CONCAT('c_',c.id) AS uniqueId,'comment' AS type,p.id AS postId,p.title AS postTitle,c.id AS commentId,
                NULL AS replyId,c.text,c.date,EXISTS(SELECT 1 FROM wgs_replies r WHERE r.commentId=c.id) AS hasReplies,c.id AS sortId
                FROM wgs_comments c JOIN wgs_posts p ON p.id=c.postId WHERE c.authorId=? AND c.text NOT LIKE '%삭제한 댓글입니다.%'
                UNION ALL SELECT CONCAT('r_',r.id),'reply',p.id,p.title,c.id,r.id,r.text,r.date,0,r.id
                FROM wgs_replies r JOIN wgs_comments c ON c.id=r.commentId JOIN wgs_posts p ON p.id=c.postId
                WHERE r.authorId=? AND r.text NOT LIKE '%삭제한 답글입니다.%'`;
            const [[commentCount]] = await pool.query(`SELECT COUNT(*) AS total FROM (${commentSql}) activity`, [viewerId, viewerId]);
            const commentsView = req.query.type === 'comments';
            const [items] = commentsView
                ? await pool.query(`SELECT * FROM (${commentSql}) activity ORDER BY CAST(sortId AS UNSIGNED) DESC,sortId DESC LIMIT ? OFFSET ?`, [viewerId, viewerId, pageSize, offset])
                : await pool.query(`SELECT ${columns} FROM wgs_posts p WHERE p.authorId=? ORDER BY CAST(p.id AS UNSIGNED) DESC,p.id DESC LIMIT ? OFFSET ?`, [viewerId, pageSize, offset]);
            return res.json({ posts: commentsView ? [] : items, comments: commentsView ? items : [], counts: { posts: postCount.total, comments: commentCount.total }, total: commentsView ? commentCount.total : postCount.total });
        } catch (_) { return res.status(500).json({ success: false, msg: '내 활동을 불러오지 못했습니다.' }); }
    });

    app.get('/api/posts/:postId', async (req, res) => {
        noStore(res);
        try {
            const viewerId = identity(await validateRealtimeSession(req));
            const [[post]] = await pool.query('SELECT boardType FROM wgs_posts WHERE id=?', [req.params.postId]);
            if (!post || (post.boardType !== 'notice' && !viewerId)) return res.status(404).json({ success: false, msg: '게시글을 볼 수 없습니다.' });
            return res.json(await getPostWithChildren(req.params.postId, viewerId));
        } catch (_) { return res.status(500).json({ success: false, msg: '게시글을 불러오지 못했습니다.' }); }
    });
}

module.exports = registerBoardReadRoutes;
