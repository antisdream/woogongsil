'use strict';

function registerStudyFolderRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const requireSessionUser = options.requireSessionUser;
    const authUserId = options.authUserId;
    const normalizeId = options.normalizeId;
    const normalizeNullableId = options.normalizeNullableId;
    const normalizeSortOrder = options.normalizeSortOrder;
    const assertFolderOwner = options.assertFolderOwner;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerStudyFolderRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerStudyFolderRoutes requires a MySQL pool.');
    }
    if (typeof requireSessionUser !== 'function') {
        throw new Error('registerStudyFolderRoutes requires requireSessionUser.');
    }
    if (typeof authUserId !== 'function') {
        throw new Error('registerStudyFolderRoutes requires authUserId.');
    }
    if (typeof normalizeId !== 'function' || typeof normalizeNullableId !== 'function' || typeof normalizeSortOrder !== 'function') {
        throw new Error('registerStudyFolderRoutes requires normalizers.');
    }
    if (typeof assertFolderOwner !== 'function') {
        throw new Error('registerStudyFolderRoutes requires assertFolderOwner.');
    }

    app.get('/api/study/tree', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.query.id);
            if (!auth) return;

            const userId = authUserId(auth);
            const scope = String(req.query.scope || 'mine').trim().toLowerCase();

            if (scope === 'public') {
                const [documents] = await pool.query(
                    `SELECT
                        id,
                        ownerId,
                        NULL AS folderId,
                        title,
                        visibility,
                        docType,
                        sortOrder,
                        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
                        DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
                     FROM wgs_study_documents
                     WHERE visibility = 'public'
                     ORDER BY updatedAt DESC, id DESC
                     LIMIT 200`
                );
                return res.json({ success: true, scope: 'public', folders: [], documents });
            }

            const [folders] = await pool.query(
                `SELECT id, ownerId, parentId, name, sortOrder,
                        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
                        DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
                   FROM wgs_study_folders
                  WHERE ownerId = ?
                  ORDER BY parentId IS NOT NULL, parentId ASC, sortOrder ASC, name ASC, id ASC`,
                [userId]
            );
            const [documents] = await pool.query(
                `SELECT id, ownerId, folderId, title, visibility, docType,
                        sortOrder,
                        DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
                        DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
                   FROM wgs_study_documents
                  WHERE ownerId = ?
                  ORDER BY folderId IS NOT NULL, folderId ASC, sortOrder ASC, title ASC, id ASC`,
                [userId]
            );

            return res.json({ success: true, scope: 'mine', folders, documents });
        } catch (error) {
            console.error('[학습노트] 트리 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '학습노트 목록을 불러오지 못했습니다.' });
        }
    });

    app.post('/api/study/folders', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const parentId = normalizeNullableId(req.body.parentId);
            const name = String(req.body.name || '').trim().slice(0, 120);
            if (!name) return res.status(400).json({ success: false, msg: '폴더 이름을 입력해주세요.' });
            if (!(await assertFolderOwner(parentId, ownerId))) {
                return res.status(404).json({ success: false, msg: '상위 폴더를 찾을 수 없습니다.' });
            }

            const [sortRows] = await pool.query(
                `SELECT COALESCE(MAX(sortOrder), 0) + 10 AS nextSortOrder
                   FROM wgs_study_folders
                  WHERE ownerId = ?
                    AND ((parentId IS NULL AND ? IS NULL) OR parentId = ?)`,
                [ownerId, parentId, parentId]
            );
            const nextSortOrder = req.body.sortOrder === undefined
                ? Number(sortRows?.[0]?.nextSortOrder || 10)
                : normalizeSortOrder(req.body.sortOrder, 0);

            const [result] = await pool.query(
                `INSERT INTO wgs_study_folders (ownerId, parentId, name, sortOrder) VALUES (?, ?, ?, ?)`,
                [ownerId, parentId, name, nextSortOrder]
            );
            return res.json({ success: true, id: result.insertId, folder: { id: result.insertId, ownerId, parentId, name, sortOrder: nextSortOrder } });
        } catch (error) {
            console.error('[학습노트] 폴더 생성 오류:', error);
            return res.status(500).json({ success: false, msg: '폴더를 만들지 못했습니다.' });
        }
    });

    app.put('/api/study/folders/:folderId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const folderId = normalizeId(req.params.folderId);
            const parentId = normalizeNullableId(req.body.parentId);
            const name = String(req.body.name || '').trim().slice(0, 120);
            if (!folderId) return res.status(400).json({ success: false, msg: '폴더 번호가 올바르지 않습니다.' });
            if (!name) return res.status(400).json({ success: false, msg: '폴더 이름을 입력해주세요.' });
            if (parentId === folderId) return res.status(400).json({ success: false, msg: '자기 자신을 상위 폴더로 지정할 수 없습니다.' });
            if (!(await assertFolderOwner(folderId, ownerId))) return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });
            if (!(await assertFolderOwner(parentId, ownerId))) return res.status(404).json({ success: false, msg: '상위 폴더를 찾을 수 없습니다.' });

            await pool.query(
                `UPDATE wgs_study_folders SET parentId = ?, name = ?, sortOrder = ? WHERE id = ? AND ownerId = ?`,
                [parentId, name, normalizeSortOrder(req.body.sortOrder, 0), folderId, ownerId]
            );
            return res.json({ success: true });
        } catch (error) {
            console.error('[학습노트] 폴더 수정 오류:', error);
            return res.status(500).json({ success: false, msg: '폴더를 수정하지 못했습니다.' });
        }
    });

    app.delete('/api/study/folders/:folderId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.body?.userId || req.query.id || req.body?.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const folderId = normalizeId(req.params.folderId);
            if (!folderId) return res.status(400).json({ success: false, msg: '폴더 번호가 올바르지 않습니다.' });
            if (!(await assertFolderOwner(folderId, ownerId))) return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });

            const [childFolders] = await pool.query(`SELECT id FROM wgs_study_folders WHERE ownerId = ? AND parentId = ? LIMIT 1`, [ownerId, folderId]);
            const [childDocs] = await pool.query(`SELECT id FROM wgs_study_documents WHERE ownerId = ? AND folderId = ? LIMIT 1`, [ownerId, folderId]);
            if (childFolders.length || childDocs.length) {
                return res.status(409).json({ success: false, msg: '폴더 안의 문서나 하위 폴더를 먼저 정리해주세요.' });
            }

            await pool.query(`DELETE FROM wgs_study_folders WHERE id = ? AND ownerId = ?`, [folderId, ownerId]);
            return res.json({ success: true });
        } catch (error) {
            console.error('[학습노트] 폴더 삭제 오류:', error);
            return res.status(500).json({ success: false, msg: '폴더를 삭제하지 못했습니다.' });
        }
    });

    app.post('/api/study/reorder', async (req, res) => {
        let connection = null;
        try {
            const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
            if (!auth) return;

            const ownerId = authUserId(auth);
            const folders = Array.isArray(req.body.folders) ? req.body.folders : [];
            const documents = Array.isArray(req.body.documents) ? req.body.documents : [];
            const folderUpdates = folders
                .map((folder) => ({
                    id: normalizeId(folder.id),
                    parentId: normalizeNullableId(folder.parentId),
                    sortOrder: normalizeSortOrder(folder.sortOrder, 0),
                }))
                .filter((folder) => folder.id);
            const documentUpdates = documents
                .map((document) => ({
                    id: normalizeId(document.id),
                    folderId: normalizeNullableId(document.folderId),
                    sortOrder: normalizeSortOrder(document.sortOrder, 0),
                }))
                .filter((document) => document.id);

            if (!folderUpdates.length && !documentUpdates.length) {
                return res.status(400).json({ success: false, msg: '변경할 순서가 없습니다.' });
            }

            const [ownerFolders] = await pool.query(
                `SELECT id, parentId FROM wgs_study_folders WHERE ownerId = ?`,
                [ownerId]
            );
            const folderMap = new Map(ownerFolders.map((folder) => [Number(folder.id), folder.parentId ? Number(folder.parentId) : null]));
            const folderIds = new Set(folderMap.keys());

            for (const folder of folderUpdates) {
                if (!folderIds.has(folder.id)) return res.status(404).json({ success: false, msg: '폴더를 찾을 수 없습니다.' });
                if (folder.parentId && !folderIds.has(folder.parentId)) return res.status(404).json({ success: false, msg: '상위 폴더를 찾을 수 없습니다.' });
                folderMap.set(folder.id, folder.parentId);
            }

            for (const folder of folderUpdates) {
                if (folder.parentId === folder.id) {
                    return res.status(400).json({ success: false, msg: '자기 자신을 상위 폴더로 지정할 수 없습니다.' });
                }

                const seen = new Set([folder.id]);
                let cursor = folder.parentId;
                while (cursor) {
                    if (seen.has(cursor)) {
                        return res.status(400).json({ success: false, msg: '하위 폴더 안으로 이동할 수 없습니다.' });
                    }
                    seen.add(cursor);
                    cursor = folderMap.get(cursor) || null;
                }
            }

            for (const document of documentUpdates) {
                if (document.folderId && !folderIds.has(document.folderId)) {
                    return res.status(404).json({ success: false, msg: '문서를 이동할 폴더를 찾을 수 없습니다.' });
                }
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();

            for (const folder of folderUpdates) {
                const [result] = await connection.query(
                    `UPDATE wgs_study_folders
                        SET parentId = ?, sortOrder = ?
                      WHERE id = ? AND ownerId = ?`,
                    [folder.parentId, folder.sortOrder, folder.id, ownerId]
                );
                if (result.affectedRows === 0) throw new Error('folder_update_failed');
            }

            for (const document of documentUpdates) {
                const [result] = await connection.query(
                    `UPDATE wgs_study_documents
                        SET folderId = ?, sortOrder = ?
                      WHERE id = ? AND ownerId = ?`,
                    [document.folderId, document.sortOrder, document.id, ownerId]
                );
                if (result.affectedRows === 0) throw new Error('document_update_failed');
            }

            await connection.commit();
            return res.json({ success: true });
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.warn('[학습노트] 순서 변경 롤백 실패:', rollbackError.message);
                }
            }
            console.error('[학습노트] 순서 변경 오류:', error);
            return res.status(500).json({ success: false, msg: '학습노트 순서를 저장하지 못했습니다.' });
        } finally {
            if (connection) connection.release();
        }
    });
}

module.exports = registerStudyFolderRoutes;
