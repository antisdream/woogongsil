'use strict';

const { normalizeBoardContentJson } = require('../../services/boardContentService');
const {
    buildDraftSummary,
    normalizeDraftSaveReason,
    parseJsonArray,
} = require('../../services/studyDraftHelpers');

function registerStudyDraftRoutes(options = {}) {
    const {
        app,
        pool,
        requireSessionUser,
        authUserId,
        normalizeId,
        normalizeNullableId,
        normalizeTitle,
        normalizeVisibility,
        normalizeDocType,
        assertFolderOwner,
        getStudyDocument,
    } = options;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerStudyDraftRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerStudyDraftRoutes requires a MySQL pool.');
    }
    if (typeof requireSessionUser !== 'function' || typeof authUserId !== 'function') {
        throw new Error('registerStudyDraftRoutes requires session helpers.');
    }

    async function getStudyDraft(draftId, ownerId) {
        const [rows] = await pool.query(
            `SELECT
                id,
                ownerId,
                documentId,
                folderId,
                title,
                content,
                contentJson,
                visibility,
                docType,
                wrongRefsJson,
                summary,
                saveReason,
                DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
                DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS savedAt
             FROM wgs_study_document_drafts
             WHERE id = ? AND ownerId = ?
             LIMIT 1`,
            [draftId, ownerId]
        );
        const draft = rows[0] || null;
        if (!draft) return null;
        return {
            ...draft,
            wrongRefs: parseJsonArray(draft.wrongRefsJson),
            wrongRefsJson: undefined,
        };
    }

    app.post('/api/study/drafts', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const documentId = normalizeNullableId(req.body.documentId);
            const folderId = normalizeNullableId(req.body.folderId);
            const title = normalizeTitle(req.body.title) || '제목 없음';
            const content = String(req.body.content || '').trim();
            const visibility = normalizeVisibility(req.body.visibility);
            const docType = normalizeDocType(req.body.docType);
            const wrongRefs = parseJsonArray(req.body.wrongRefs);
            const saveReason = normalizeDraftSaveReason(req.body.saveReason);
            let contentJson = null;

            if (documentId) {
                const document = await getStudyDocument(documentId);
                if (!document || document.ownerId !== ownerId) {
                    return res.status(404).json({ success: false, msg: '문서를 찾을 수 없습니다.' });
                }
            }
            if (!(await assertFolderOwner(folderId, ownerId))) {
                return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });
            }

            try {
                contentJson = normalizeBoardContentJson(req.body.contentJson);
            } catch {
                return res.status(400).json({ success: false, msg: '임시저장 에디터 데이터 형식이 올바르지 않습니다.' });
            }

            const summary = buildDraftSummary(title, content, contentJson);
            const wrongRefsJson = JSON.stringify(wrongRefs);
            const [result] = await pool.query(
                `INSERT INTO wgs_study_document_drafts
                    (ownerId, documentId, folderId, title, content, contentJson, visibility, docType, wrongRefsJson, summary, saveReason)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ownerId, documentId, folderId, title, content, contentJson, visibility, docType, wrongRefsJson, summary, saveReason]
            );

            const draft = await getStudyDraft(result.insertId, ownerId);
            return res.json({ success: true, id: result.insertId, draft });
        } catch (error) {
            console.error('[학습노트] 임시저장 오류:', error);
            return res.status(500).json({ success: false, msg: '임시저장을 저장하지 못했습니다.' });
        }
    });

    app.get('/api/study/drafts', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.query.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const page = Math.max(1, Math.trunc(Number(req.query.page || 1)) || 1);
            const pageSize = Math.min(10, Math.max(1, Math.trunc(Number(req.query.pageSize || 10)) || 10));
            const offset = (page - 1) * pageSize;
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM wgs_study_document_drafts WHERE ownerId = ?`,
                [ownerId]
            );
            const total = Number(countRows?.[0]?.total || 0);
            const [drafts] = await pool.query(
                `SELECT
                    id,
                    documentId,
                    folderId,
                    title,
                    summary,
                    saveReason,
                    DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS savedAt
                 FROM wgs_study_document_drafts
                 WHERE ownerId = ?
                 ORDER BY updatedAt DESC, id DESC
                 LIMIT ? OFFSET ?`,
                [ownerId, pageSize, offset]
            );

            return res.json({
                success: true,
                drafts,
                page,
                pageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
            });
        } catch (error) {
            console.error('[학습노트] 임시저장 목록 오류:', error);
            return res.status(500).json({ success: false, msg: '임시저장 목록을 불러오지 못했습니다.' });
        }
    });

    app.get('/api/study/drafts/:draftId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.query.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const draftId = normalizeId(req.params.draftId);
            if (!draftId) return res.status(400).json({ success: false, msg: '임시저장 번호가 올바르지 않습니다.' });

            const draft = await getStudyDraft(draftId, ownerId);
            if (!draft) return res.status(404).json({ success: false, msg: '임시저장을 찾을 수 없습니다.' });

            return res.json({ success: true, draft });
        } catch (error) {
            console.error('[학습노트] 임시저장 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '임시저장을 불러오지 못했습니다.' });
        }
    });

    app.delete('/api/study/drafts/:draftId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.body?.userId || req.query.id || req.body?.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const draftId = normalizeId(req.params.draftId);
            if (!draftId) return res.status(400).json({ success: false, msg: '임시저장 번호가 올바르지 않습니다.' });

            const [result] = await pool.query(
                `DELETE FROM wgs_study_document_drafts WHERE id = ? AND ownerId = ?`,
                [draftId, ownerId]
            );
            if (result.affectedRows === 0) return res.status(404).json({ success: false, msg: '임시저장을 찾을 수 없습니다.' });

            return res.json({ success: true });
        } catch (error) {
            console.error('[학습노트] 임시저장 삭제 오류:', error);
            return res.status(500).json({ success: false, msg: '임시저장을 삭제하지 못했습니다.' });
        }
    });
}

module.exports = registerStudyDraftRoutes;
