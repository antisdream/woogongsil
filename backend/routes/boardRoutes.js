'use strict';
const { runtimeLog: wgsRuntimeLog } = require("../services/runtimeLog");

const crypto = require('node:crypto');
const { normalizeBoardContentJson } = require('../services/boardContentService');
const { parseBoardType, storedBoardType, BoardPolicyError } = require('../services/boardPolicyService');
const { createBoardUploadHandler } = require('../services/boardUploadService');
const { UploadAccessError } = require('../services/uploadAccessService');
const registerBoardReadRoutes = require('./boardReadRoutes');

function registerBoardRoutes(options = {}) {
    const { app, pool, backendDir, getPostWithChildren, getBoardDateString, getUserById,
        sendEmail, sendNoticePostEmailsInBackground, validateRealtimeSession, uploadAccessService } = options;
    if (!app || !pool || !validateRealtimeSession || !uploadAccessService) throw new Error('Board routes require database, authentication and attachment access services.');
    const idOf = auth => String(auth?.user?.id || auth?.id || '');
    const nameOf = auth => String(auth?.user?.name || idOf(auth));
    const newId = () => `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const isManager = req => req.path.startsWith('/api/admin/board/') && req.adminAuth?.valid === true && req.adminAuth.isPrimaryAdmin === true;
    const error = (message, status = 403) => new BoardPolicyError(message, status);
    const alias = route => ['/api'+route, '/api/admin/board'+route];
    const wrap = handler => async (req, res) => {
        try { await handler(req, res); }
        catch (failure) {
            if (res.headersSent) return;
            const known = failure instanceof BoardPolicyError || failure instanceof UploadAccessError;
            if (!known) wgsRuntimeLog("error", "routes/boardRoutes.js:24", '[board request]', failure.code || 'unexpected_error');
            res.status(known ? failure.status : 500).json({ success: false, msg: known ? failure.message : '게시판 요청을 처리하지 못했습니다.' });
        }
    };
    async function requireSessionUser(req, res, expected = '') {
        const adminPath = req.path.startsWith('/api/admin/board/');
        const auth = adminPath ? (isManager(req) ? req.adminAuth : { valid: false }) : await validateRealtimeSession(req);
        if (!auth?.valid) { res.status(401).json({ success: false, reason: adminPath ? 'admin_email_otp_required' : 'session_expired', msg: '로그인 인증이 필요합니다.' }); return null; }
        if (expected && String(expected) !== idOf(auth)) { res.status(403).json({ success: false, msg: '본인 계정으로만 처리할 수 있습니다.' }); return null; }
        return auth;
    }
    const session = (req, res) => requireSessionUser(req, res, req.body?.userId || req.body?.id || req.body?.authorId);
    const manager = req => { if (!isManager(req)) throw error('관리자 이메일 인증 후 공지 관리 기능을 이용해주세요.'); };
    const assertPostOwner = (req, post, userId, nextType = storedBoardType(post)) => {
        if (!post) throw error('게시글을 찾을 수 없습니다.', 404);
        if (!isManager(req) && (post.authorId !== userId || storedBoardType(post) === 'notice' || nextType !== storedBoardType(post))) throw error('게시글 관리 권한이 없습니다.');
    };
    function contentInput(body) {
        const title = String(body.title || '').trim(), content = String(body.content || '').trim();
        if (!title || !content) throw error('제목과 내용을 입력해주세요.', 400);
        if (title.length > 200 || Buffer.byteLength(content) > 1024 * 1024) throw error('게시글 제목이나 내용이 너무 깁니다.', 400);
        let contentJson;
        try { contentJson = normalizeBoardContentJson(body.contentJson); } catch (_) { throw error('게시글 에디터 데이터 형식이 올바르지 않습니다.', 400); }
        if (Buffer.byteLength(contentJson || '') > 2 * 1024 * 1024) throw error('게시글 에디터 데이터가 너무 큽니다.', 400);
        return { title, content, contentJson };
    }
    const commentText = req => {
        const text = String(req.body.text || '').trim();
        if (!text || text.length > 100) throw error('댓글은 1자 이상 100자 이하로 입력해주세요.', 400);
        return text;
    };
    async function transaction(action) {
        const db = await pool.getConnection();
        try { await db.beginTransaction(); const result = await action(db); await db.commit(); return result; }
        catch (failure) { await db.rollback(); throw failure; }
        finally { db.release(); }
    }
    // The recipient is derived from the successful mutation, never from a client-supplied address or account.
    async function notifyPostAuthor(postId, auth, type) {
        try {
            const [[post]] = await pool.query('SELECT authorId FROM wgs_posts WHERE id=?', [postId]);
            if (!post || post.authorId === idOf(auth)) return;
            const user = await getUserById(post.authorId);
            if (!user?.email) return;
            const action = type === 'like' ? '좋아요를 눌렀습니다' : '댓글을 남겼습니다';
            await sendEmail(user.email, `[우공실 알림] ${nameOf(auth)}님이 ${action}.`, `우공실 게시글에 ${nameOf(auth)}님이 ${action}.\nhttps://woogongsil.site/board/post/${encodeURIComponent(postId)}`);
        } catch (failure) { wgsRuntimeLog("error", "routes/boardRoutes.js:70", '[board notification]', failure.code || 'delivery_failed'); }
    }

    registerBoardReadRoutes({ app, pool, validateRealtimeSession, getPostWithChildren });
    app.post('/api/posts/upload-file', createBoardUploadHandler({ backendDir, requireSessionUser, uploadBucket: 'board', uploadAccessService }));

    app.post(alias('/posts'), wrap(async (req, res) => {
        const auth = await session(req, res); if (!auth) return;
        const input = contentInput(req.body), boardType = parseBoardType(req.body.boardType), id = newId();
        if (boardType === 'notice') manager(req);
        await uploadAccessService.mutateDocument({ resourceType: 'board', actorId: idOf(auth) }, async db => {
            await db.query(`INSERT INTO wgs_posts(id,title,content,contentJson,authorId,authorName,date,boardType,views,likes,isNotice)
                VALUES(?,?,?,?,?,?,?,?,0,0,0)`, [id,input.title,input.content,input.contentJson,idOf(auth),nameOf(auth),getBoardDateString(),boardType]);
            return { resourceId: id, ...input };
        });
        const queued = boardType === 'notice';
        if (queued) sendNoticePostEmailsInBackground({ authorId: idOf(auth), postId: id, title: input.title }).catch(failure => wgsRuntimeLog("error", "routes/boardRoutes.js:86", '[notice mail]', failure.code || 'delivery_failed'));
        res.json({ success: true, id, noticeEmailQueued: queued, msg: '게시글이 등록되었습니다.' });
    }));

    app.put(alias('/posts/notice'), wrap(async (req, res) => {
        const auth = await session(req, res); if (!auth) return; manager(req);
        const ids = [...new Set((Array.isArray(req.body.postIds) ? req.body.postIds : []).map(String))];
        if (!ids.length || ids.length > 100) throw error('게시글은 1개 이상 100개 이하로 선택해주세요.', 400);
        const pin = req.body.isNotice === true || req.body.isNotice === 1;
        await transaction(async db => {
            // A single lock order serializes pin/order operations across administrators.
            const [rows] = await db.query('SELECT id,isNotice,noticeOrder FROM wgs_posts ORDER BY id FOR UPDATE');
            const existing = new Map(rows.map(post => [post.id,post]));
            if (ids.some(id => !existing.has(id))) throw error('일부 게시글을 찾을 수 없습니다.', 404);
            if (pin && rows.filter(post => post.isNotice || ids.includes(post.id)).length > 100) throw error('상단에 고정할 수 있는 글은 최대 100개입니다.', 400);
            let order = Math.max(0,...rows.map(post => Number(post.noticeOrder)||0))+1;
            for (const id of ids) await db.query('UPDATE wgs_posts SET isNotice=?,noticeOrder=? WHERE id=?', [pin ? 1 : 0,pin ? existing.get(id).noticeOrder || order++ : null,id]);
        });
        res.json({ success:true });
    }));
    app.put(alias('/posts/notice-order'), wrap(async (req,res) => {
        const auth = await session(req,res); if (!auth) return; manager(req);
        const ids = req.body.orderedPostIds;
        if (!Array.isArray(ids) || !ids.length || ids.length>100 || new Set(ids.map(String)).size!==ids.length) throw error('공지 순서를 확인해주세요.',400);
        await transaction(async db => {
            const [rows] = await db.query('SELECT id,isNotice FROM wgs_posts ORDER BY id FOR UPDATE');
            if (ids.some(id=>!rows.some(post=>post.id===String(id)&&post.isNotice))) throw error('선택한 공지 상태가 변경되었습니다. 목록을 다시 확인해주세요.',409);
            for(let i=0;i<ids.length;i++) await db.query('UPDATE wgs_posts SET noticeOrder=? WHERE id=?',[i+1,String(ids[i])]);
        });
        res.json({success:true});
    }));
    app.put('/api/admin/board/posts/:postId/board-type', wrap(async (req,res) => {
        const auth = await session(req,res); if (!auth) return; manager(req);
        const type=parseBoardType(req.body.boardType);
        const [result]=await pool.query('UPDATE wgs_posts SET boardType=? WHERE id=?',[type,req.params.postId]);
        if (!result.affectedRows) throw error('게시글을 찾을 수 없습니다.',404);
        res.json({success:true});
    }));
    app.put(alias('/posts/:postId'), wrap(async(req,res)=>{
        const auth=await session(req,res); if(!auth)return;
        const input=contentInput(req.body);
        await uploadAccessService.mutateDocument({resourceType:'board',resourceId:req.params.postId,actorId:idOf(auth)},async(db,post)=>{
            const type=parseBoardType(req.body.boardType,storedBoardType(post)); assertPostOwner(req,post,idOf(auth),type);
            const contentJson=Object.hasOwn(req.body,'contentJson')?input.contentJson:post.contentJson;
            await db.query('UPDATE wgs_posts SET title=?,content=?,contentJson=?,boardType=? WHERE id=?',[input.title,input.content,contentJson,type,post.id]);
            return {...input,contentJson};
        });
        res.json({success:true,post:await getPostWithChildren(req.params.postId,idOf(auth))});
    }));
    app.delete(alias('/posts/:id'),wrap(async(req,res)=>{
        const auth=await session(req,res); if(!auth)return;
        await uploadAccessService.mutateDocument({resourceType:'board',resourceId:req.params.id,actorId:idOf(auth)},async(db,post)=>{
            assertPostOwner(req,post,idOf(auth)); await db.query('DELETE FROM wgs_posts WHERE id=?',[post.id]); return {};
        });
        res.json({success:true,msg:'게시글이 삭제되었습니다.'});
    }));

    app.post('/api/posts/:postId/view',wrap(async(req,res)=>{
        const auth=await validateRealtimeSession(req);
        const [result]=await pool.query("UPDATE wgs_posts SET views=COALESCE(views,0)+1 WHERE id=? AND (boardType='notice' OR ?=1)",[req.params.postId,auth?.valid?1:0]);
        if(!result.affectedRows)throw error('게시글을 볼 수 없습니다.',404);
        const [[post]]=await pool.query('SELECT views FROM wgs_posts WHERE id=?',[req.params.postId]); res.json({success:true,views:post.views});
    }));
    app.post('/api/posts/:postId/like',wrap(async(req,res)=>{
        const auth=await session(req,res); if(!auth)return;
        const result=await transaction(async db=>{
            const [[post]]=await db.query('SELECT id FROM wgs_posts WHERE id=? FOR UPDATE',[req.params.postId]); if(!post)throw error('게시글을 찾을 수 없습니다.',404);
            const [likes]=await db.query('SELECT 1 FROM wgs_post_likes WHERE postId=? AND userId=?',[post.id,idOf(auth)]);
            if(likes.length)await db.query('DELETE FROM wgs_post_likes WHERE postId=? AND userId=?',[post.id,idOf(auth)]);
            else await db.query('INSERT INTO wgs_post_likes(postId,userId) VALUES(?,?)',[post.id,idOf(auth)]);
            const [[count]]=await db.query('SELECT COUNT(*) AS likes FROM wgs_post_likes WHERE postId=?',[post.id]);
            await db.query('UPDATE wgs_posts SET likes=? WHERE id=?',[count.likes,post.id]);
            return {likes:count.likes,likedUsers:likes.length?[]:[idOf(auth)]};
        });
        if(result.likedUsers.length)void notifyPostAuthor(req.params.postId,auth,'like');
        res.json({success:true,...result});
    }));

    app.post('/api/posts/:id/comments',wrap(async(req,res)=>{
        const auth=await session(req,res); if(!auth)return; const text=commentText(req);
        const [[post]]=await pool.query('SELECT id FROM wgs_posts WHERE id=?',[req.params.id]); if(!post)throw error('게시글을 찾을 수 없습니다.',404);
        await pool.query('INSERT INTO wgs_comments(id,postId,text,authorId,authorName,date) VALUES(?,?,?,?,?,?)',[newId(),post.id,text,idOf(auth),nameOf(auth),getBoardDateString()]);
        void notifyPostAuthor(post.id,auth,'comment'); res.json({success:true});
    }));
    app.post('/api/posts/:postId/comments/:commentId/replies',wrap(async(req,res)=>{
        const auth=await session(req,res); if(!auth)return; const text=commentText(req);
        const [[comment]]=await pool.query('SELECT id FROM wgs_comments WHERE id=? AND postId=?',[req.params.commentId,req.params.postId]); if(!comment)throw error('댓글을 찾을 수 없습니다.',404);
        await pool.query('INSERT INTO wgs_replies(id,commentId,text,authorId,authorName,date) VALUES(?,?,?,?,?,?)',[newId(),comment.id,text,idOf(auth),nameOf(auth),getBoardDateString()]);
        void notifyPostAuthor(req.params.postId,auth,'comment'); res.json({success:true});
    }));
    for(const kind of ['comment','reply']) {
        const route=kind==='comment'?'/posts/:postId/comments/:commentId':'/posts/:postId/comments/:commentId/replies/:replyId';
        for(const method of ['put','delete']) app[method](alias(route),wrap(async(req,res)=>{
            const auth=await session(req,res); if(!auth)return;
            await transaction(async db=>{
                const [[item]]=kind==='comment'
                    ?await db.query('SELECT * FROM wgs_comments WHERE id=? AND postId=? FOR UPDATE',[req.params.commentId,req.params.postId])
                    :await db.query('SELECT r.* FROM wgs_replies r JOIN wgs_comments c ON c.id=r.commentId WHERE r.id=? AND r.commentId=? AND c.postId=? FOR UPDATE',[req.params.replyId,req.params.commentId,req.params.postId]);
                if(!item)throw error('댓글을 찾을 수 없습니다.',404);
                if(item.authorId!==idOf(auth)&&!isManager(req))throw error('댓글 관리 권한이 없습니다.');
                if(method==='delete'&&kind==='comment'&&!isManager(req)) {
                    const [replies]=await db.query('SELECT id FROM wgs_replies WHERE commentId=? LIMIT 1',[item.id]);
                    if(replies.length)throw error('대댓글이 달린 댓글은 관리자만 삭제할 수 있습니다.');
                }
                const text=method==='put'?commentText(req):`${isManager(req)?'관리자':'작성자'}가 삭제한 ${kind==='comment'?'댓글':'답글'}입니다.`;
                await db.query(`UPDATE ${kind==='comment'?'wgs_comments':'wgs_replies'} SET text=? WHERE id=?`,[text,item.id]);
            });
            res.json({success:true});
        }));
    }
    app.post('/api/posts/notify-email',(_req,res)=>res.status(410).json({success:false,msg:'알림은 게시판 동작 완료 후 서버에서 처리합니다.'}));
}
module.exports=registerBoardRoutes;
