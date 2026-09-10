'use strict';
const { runtimeLog: wgsRuntimeLog } = require("../../services/runtimeLog");


const { UploadAccessError } = require('../../services/uploadAccessService');
const { normalizeBoardContentJson } = require('../../services/boardContentService');
const { replaceStudyDocumentWrongRefs } = require('../../services/studyWrongRefService');

function registerStudyDocumentRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const uploadAccessService = options.uploadAccessService;
    const requireSessionUser = options.requireSessionUser;
    const authUserId = options.authUserId;
    const normalizeId = options.normalizeId;
    const normalizeNullableId = options.normalizeNullableId;
    const normalizeTitle = options.normalizeTitle;
    const normalizeVisibility = options.normalizeVisibility;
    const normalizeDocType = options.normalizeDocType;
    const normalizeSortOrder = options.normalizeSortOrder;
    const assertFolderOwner = options.assertFolderOwner;
    const getStudyDocument = options.getStudyDocument;

    if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires a MySQL pool.');
    }
    if (typeof requireSessionUser !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires requireSessionUser.');
    }
    if (typeof authUserId !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires authUserId.');
    }
    if (
        typeof normalizeId !== 'function' ||
        typeof normalizeNullableId !== 'function' ||
        typeof normalizeTitle !== 'function' ||
        typeof normalizeVisibility !== 'function' ||
        typeof normalizeDocType !== 'function' ||
        typeof normalizeSortOrder !== 'function'
    ) {
        throw new Error('registerStudyDocumentRoutes requires normalizers.');
    }
    if (typeof assertFolderOwner !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires assertFolderOwner.');
    }
    if (typeof getStudyDocument !== 'function') {
        throw new Error('registerStudyDocumentRoutes requires getStudyDocument.');
    }

    app.post('/api/study/documents', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const folderId = normalizeNullableId(req.body.folderId);
            const title = normalizeTitle(req.body.title);
            const content = String(req.body.content || '').trim();
            const visibility = normalizeVisibility(req.body.visibility);
            const docType = normalizeDocType(req.body.docType);
            let contentJson = null;

            if (!title) return res.status(400).json({ success: false, msg: '문서 제목을 입력해주세요.' });
            if (!(await assertFolderOwner(folderId, ownerId))) {
                return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });
            }

            try {
                contentJson = normalizeBoardContentJson(req.body.contentJson);
            } catch (error) {
                return res.status(400).json({ success: false, msg: '문서 에디터 데이터 형식이 올바르지 않습니다.' });
            }

            const [sortRows] = await pool.query(
                `SELECT COALESCE(MAX(sortOrder), 0) + 10 AS nextSortOrder
                   FROM wgs_study_documents
                  WHERE ownerId = ?
                    AND ((folderId IS NULL AND ? IS NULL) OR folderId = ?)`,
                [ownerId, folderId, folderId]
            );
            const nextSortOrder = req.body.sortOrder === undefined
                ? Number(sortRows?.[0]?.nextSortOrder || 10)
                : normalizeSortOrder(req.body.sortOrder, 0);

            const result = await uploadAccessService.mutateDocument({ resourceType: 'study', actorId: ownerId }, async db => {
            const [result] = await db.query(
                `INSERT INTO wgs_study_documents (ownerId, folderId, title, content, contentJson, visibility, docType, sortOrder)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [ownerId, folderId, title, content, contentJson, visibility, docType, nextSortOrder]
            );
            await replaceStudyDocumentWrongRefs(db, result.insertId, ownerId, req.body.wrongRefs);

                return { resourceId: result.insertId, content, contentJson, result };
            });

            const document = await getStudyDocument(result.insertId);
            return res.json({ success: true, id: result.insertId, document });
        } catch (error) {
            if (error instanceof UploadAccessError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "routes/study/studyDocumentRoutes.js:101", '[학습노트] 문서 생성 오류:', error);
            return res.status(500).json({ success: false, msg: '문서를 저장하지 못했습니다.' });
        }
    });

    app.get('/api/study/documents/:documentId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.query.id);
            if (!auth) return;

            const requesterId = authUserId(auth);
            const documentId = normalizeId(req.params.documentId);
            if (!documentId) return res.status(400).json({ success: false, msg: '문서 번호가 올바르지 않습니다.' });

            const document = await getStudyDocument(documentId);
            if (!document) return res.status(404).json({ success: false, msg: '문서를 찾을 수 없습니다.' });
            if (document.ownerId !== requesterId && document.visibility !== 'public') {
                return res.status(403).json({ success: false, msg: '문서를 볼 권한이 없습니다.' });
            }

            const [wrongRefs] = await pool.query(
                `SELECT id, sourceType, sourceId, sourcePayload,
                        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
                   FROM wgs_study_document_wrong_refs
                  WHERE documentId = ?
                  ORDER BY id ASC`,
                [documentId]
            );

            return res.json({ success: true, document: { ...document, wrongRefs } });
        } catch (error) {
            if (error instanceof UploadAccessError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "routes/study/studyDocumentRoutes.js:133", '[학습노트] 문서 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '문서를 불러오지 못했습니다.' });
        }
    });

    app.put('/api/study/documents/:documentId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const documentId = normalizeId(req.params.documentId);
            const folderId = normalizeNullableId(req.body.folderId);
            const title = normalizeTitle(req.body.title);
            const content = String(req.body.content || '').trim();
            const visibility = normalizeVisibility(req.body.visibility);
            const docType = normalizeDocType(req.body.docType);
            let contentJson = null;

            if (!documentId) return res.status(400).json({ success: false, msg: '문서 번호가 올바르지 않습니다.' });
            if (!title) return res.status(400).json({ success: false, msg: '문서 제목을 입력해주세요.' });
            if (!(await assertFolderOwner(folderId, ownerId))) return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });

            const document = await getStudyDocument(documentId);
            if (!document || document.ownerId !== ownerId) return res.status(404).json({ success: false, msg: '문서를 찾을 수 없습니다.' });

            try {
                contentJson = normalizeBoardContentJson(req.body.contentJson);
            } catch (error) {
                return res.status(400).json({ success: false, msg: '문서 에디터 데이터 형식이 올바르지 않습니다.' });
            }

            await uploadAccessService.mutateDocument({ resourceType: 'study', resourceId: documentId, actorId: ownerId }, async (db, current) => {
                if (!current || current.ownerId !== ownerId) throw new UploadAccessError('문서를 찾을 수 없습니다.', 404);
            await db.query(
                `UPDATE wgs_study_documents
                    SET folderId = ?, title = ?, content = ?, contentJson = ?, visibility = ?, docType = ?, sortOrder = ?
                  WHERE id = ? AND ownerId = ?`,
                [folderId, title, content, contentJson, visibility, docType, normalizeSortOrder(req.body.sortOrder, document.sortOrder || 0), documentId, ownerId]
            );
            await replaceStudyDocumentWrongRefs(db, documentId, ownerId, req.body.wrongRefs);

                return { content, contentJson };
            });

            const updatedDocument = await getStudyDocument(documentId);
            return res.json({ success: true, document: updatedDocument });
        } catch (error) {
            if (error instanceof UploadAccessError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "routes/study/studyDocumentRoutes.js:182", '[학습노트] 문서 수정 오류:', error);
            return res.status(500).json({ success: false, msg: '문서를 수정하지 못했습니다.' });
        }
    });

    app.patch('/api/study/documents/:documentId/meta', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const documentId = normalizeId(req.params.documentId);
            const folderId = req.body.folderId === undefined ? undefined : normalizeNullableId(req.body.folderId);
            const title = req.body.title === undefined ? undefined : normalizeTitle(req.body.title);
            const sortOrder = req.body.sortOrder === undefined ? undefined : normalizeSortOrder(req.body.sortOrder, 0);

            if (!documentId) return res.status(400).json({ success: false, msg: '문서 번호가 올바르지 않습니다.' });
            const document = await getStudyDocument(documentId);
            if (!document || document.ownerId !== ownerId) return res.status(404).json({ success: false, msg: '문서를 찾을 수 없습니다.' });
            if (title !== undefined && !title) return res.status(400).json({ success: false, msg: '문서 제목을 입력해주세요.' });
            if (folderId !== undefined && !(await assertFolderOwner(folderId, ownerId))) {
                return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });
            }

            await pool.query(
                `UPDATE wgs_study_documents
                    SET folderId = ?, title = ?, sortOrder = ?
                  WHERE id = ? AND ownerId = ?`,
                [
                    folderId === undefined ? document.folderId : folderId,
                    title === undefined ? document.title : title,
                    sortOrder === undefined ? document.sortOrder : sortOrder,
                    documentId,
                    ownerId,
                ]
            );

            const updatedDocument = await getStudyDocument(documentId);
            return res.json({ success: true, document: updatedDocument });
        } catch (error) {
            if (error instanceof UploadAccessError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "routes/study/studyDocumentRoutes.js:223", '[학습노트] 문서 메타 수정 오류:', error);
            return res.status(500).json({ success: false, msg: '문서 정보를 수정하지 못했습니다.' });
        }
    });

    app.delete('/api/study/documents/:documentId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.body?.userId || req.query.id || req.body?.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const documentId = normalizeId(req.params.documentId);
            if (!documentId) return res.status(400).json({ success: false, msg: '문서 번호가 올바르지 않습니다.' });

            const document = await getStudyDocument(documentId);
            if (!document || document.ownerId !== ownerId) return res.status(404).json({ success: false, msg: '문서를 찾을 수 없습니다.' });

            await uploadAccessService.mutateDocument({ resourceType: 'study', resourceId: documentId, actorId: ownerId }, async (db, current) => {
                if (!current || current.ownerId !== ownerId) throw new UploadAccessError('문서를 찾을 수 없습니다.', 404);
            await db.query(`DELETE FROM wgs_study_document_wrong_refs WHERE documentId = ? AND ownerId = ?`, [documentId, ownerId]);
            await db.query(`DELETE FROM wgs_study_documents WHERE id = ? AND ownerId = ?`, [documentId, ownerId]);
                return {};
            });
            return res.json({ success: true });
        } catch (error) {
            if (error instanceof UploadAccessError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "routes/study/studyDocumentRoutes.js:249", '[학습노트] 문서 삭제 오류:', error);
            return res.status(500).json({ success: false, msg: '문서를 삭제하지 못했습니다.' });
        }
    });
}

module.exports = registerStudyDocumentRoutes;
