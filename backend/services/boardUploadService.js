'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;
const BOARD_UPLOAD_ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/x-hwp',
    'application/haansofthwp',
]);

const BOARD_UPLOAD_EXTENSION_BY_MIME = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/x-hwp': '.hwp',
    'application/haansofthwp': '.hwp',
};

function isBoardUploadMimeAllowed(mimeType) {
    if (!mimeType) return false;
    if (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return true;
    return BOARD_UPLOAD_ALLOWED_MIME_TYPES.has(mimeType);
}

function getBoardUploadExtension(originalName, mimeType) {
    const rawExt = path.extname(String(originalName || '')).toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (rawExt && rawExt.length <= 12) return rawExt;
    return BOARD_UPLOAD_EXTENSION_BY_MIME[mimeType] || '.bin';
}

function createBoardUploadHandler(options = {}) {
    const backendDir = options.backendDir || path.join(__dirname, '..');
    const requireSessionUser = options.requireSessionUser;

    if (typeof requireSessionUser !== 'function') {
        throw new Error('createBoardUploadHandler requires requireSessionUser.');
    }

    return async function handleBoardUpload(req, res) {
        const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
        if (!auth) return;

        const originalName = String(req.body.fileName || 'board-file').trim();
        const bodyMimeType = String(req.body.mimeType || '').trim().toLowerCase();
        const dataUrl = String(req.body.dataUrl || req.body.data || '').trim();
        const dataUrlMatch = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
        const mimeType = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : bodyMimeType;
        const base64Data = dataUrlMatch ? dataUrlMatch[2] : dataUrl;

        if (!base64Data || !isBoardUploadMimeAllowed(mimeType)) {
            return res.status(400).json({ success: false, msg: '지원하지 않는 파일 형식입니다.' });
        }

        let buffer;
        try {
            buffer = Buffer.from(base64Data, 'base64');
        } catch (error) {
            return res.status(400).json({ success: false, msg: '파일 데이터를 읽을 수 없습니다.' });
        }

        if (!buffer.length || buffer.length > BOARD_UPLOAD_MAX_BYTES) {
            return res.status(400).json({ success: false, msg: '파일은 7MB 이하만 업로드할 수 있습니다.' });
        }

        try {
            const uploadDir = path.join(backendDir, 'uploads', 'board');
            await fs.promises.mkdir(uploadDir, { recursive: true });

            const extension = getBoardUploadExtension(originalName, mimeType);
            const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extension}`;
            const filePath = path.join(uploadDir, fileName);

            await fs.promises.writeFile(filePath, buffer);

            return res.json({
                success: true,
                url: `/uploads/board/${fileName}`,
                name: originalName,
                size: buffer.length,
                mimeType,
            });
        } catch (error) {
            console.error('게시판 파일 업로드 오류:', error);
            return res.status(500).json({ success: false, msg: '파일 업로드 중 오류가 발생했습니다.' });
        }
    };
}

module.exports = {
    createBoardUploadHandler,
};
