'use strict';

const { createBoardUploadHandler } = require('../services/boardUploadService');
const registerStudyDocumentRoutes = require('./study/studyDocumentRoutes');
const registerStudyDraftRoutes = require('./study/studyDraftRoutes');
const registerStudyFolderRoutes = require('./study/studyFolderRoutes');
const registerStudyWrongNoteRoutes = require('./study/studyWrongNoteRoutes');

function registerStudyRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const backendDir = options.backendDir;
    const uploadAccessService = options.uploadAccessService;
    if (!uploadAccessService) throw new Error('Study routes require attachment access service.');
    const validateRealtimeSession = options.validateRealtimeSession;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerStudyRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerStudyRoutes requires a MySQL pool.');
    }
    if (typeof validateRealtimeSession !== 'function') {
        throw new Error('registerStudyRoutes requires validateRealtimeSession.');
    }

    function authUserId(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    async function requireSessionUser(req, res, expectedId = '') {
        const auth = await validateRealtimeSession(req);
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

    function normalizeId(value) {
        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
        return numeric;
    }

    function normalizeNullableId(value) {
        if (value === undefined || value === null || value === '') return null;
        return normalizeId(value);
    }

    function normalizeVisibility(value) {
        return String(value || '').trim().toLowerCase() === 'public' ? 'public' : 'private';
    }

    function normalizeDocType(value) {
        const raw = String(value || 'note').trim().toLowerCase();
        return ['note', 'wrong-note', 'summary'].includes(raw) ? raw : 'note';
    }

    function normalizeTitle(value) {
        const title = String(value || '').trim();
        return title.slice(0, 255);
    }

    function normalizeSortOrder(value, fallback = 0) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.trunc(numeric);
    }

    async function assertFolderOwner(folderId, ownerId) {
        if (!folderId) return true;
        const [rows] = await pool.query(
            `SELECT id FROM wgs_study_folders WHERE id = ? AND ownerId = ? LIMIT 1`,
            [folderId, ownerId]
        );
        return rows.length > 0;
    }

    async function getStudyDocument(documentId) {
        const [rows] = await pool.query(
            `SELECT
                id,
                ownerId,
                folderId,
                title,
                content,
                contentJson,
                visibility,
                docType,
                sortOrder,
                DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
                DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt
             FROM wgs_study_documents
             WHERE id = ?
             LIMIT 1`,
            [documentId]
        );
        return rows[0] || null;
    }

    app.post('/api/study/upload-file', createBoardUploadHandler({ backendDir, requireSessionUser, uploadBucket: 'study', uploadAccessService }));

    registerStudyFolderRoutes({
        app,
        pool,
        requireSessionUser,
        authUserId,
        normalizeId,
        normalizeNullableId,
        normalizeSortOrder,
        assertFolderOwner,
    });

    registerStudyDocumentRoutes({
        uploadAccessService,
        app,
        pool,
        requireSessionUser,
        authUserId,
        normalizeId,
        normalizeNullableId,
        normalizeTitle,
        normalizeVisibility,
        normalizeDocType,
        normalizeSortOrder,
        assertFolderOwner,
        getStudyDocument,
    });

    registerStudyDraftRoutes({
        uploadAccessService,
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
    });

    registerStudyWrongNoteRoutes({
        app,
        pool,
        requireSessionUser,
        authUserId,
    });
}

module.exports = registerStudyRoutes;
