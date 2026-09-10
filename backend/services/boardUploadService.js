'use strict';
const { runtimeLog: wgsRuntimeLog } = require("./runtimeLog");


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { validateUploadContent, UploadContentError } = require('./uploadContentSecurity');
let activeUploads = 0;

const MB = 1024 * 1024;
const GB = 1024 * MB;

const BOARD_UPLOAD_LIMITS = Object.freeze({
    image: 5 * MB,
    file: 20 * MB,
    audio: 30 * MB,
    video: 30 * MB,
    userTotal: readPositiveByteEnv('WGS_UPLOAD_USER_LIMIT_BYTES', 1 * GB),
    allTotal: readPositiveByteEnv('WGS_UPLOAD_TOTAL_LIMIT_BYTES', 20 * GB),
});

const BOARD_UPLOAD_MAX_BYTES = Math.max(
    BOARD_UPLOAD_LIMITS.image,
    BOARD_UPLOAD_LIMITS.file,
    BOARD_UPLOAD_LIMITS.audio,
    BOARD_UPLOAD_LIMITS.video
);

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

const BOARD_UPLOAD_ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.mp3', '.wav',
    '.pdf', '.zip', '.txt', '.csv', '.json',
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.hwp',
]);

function readPositiveByteEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function formatUploadSize(bytes) {
    if (bytes >= GB) return `${Math.round((bytes / GB) * 10) / 10}GB`;
    return `${Math.round((bytes / MB) * 10) / 10}MB`;
}

function normalizeUploadText(value) {
    if (Array.isArray(value)) return String(value[0] || '').trim();
    return String(value || '').trim();
}

function getAuthUserId(auth) {
    return normalizeUploadText(auth?.user?.id || auth?.id || auth?.userId);
}

function sanitizeUploadPathSegment(value) {
    const sanitized = normalizeUploadText(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return sanitized || 'unknown';
}

function isBoardUploadMimeAllowed(mimeType) {
    if (!mimeType) return false;
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav'].includes(mimeType)) return true;
    return BOARD_UPLOAD_ALLOWED_MIME_TYPES.has(mimeType);
}

function getBoardUploadKind(mimeType, originalName = '') {
    const normalizedMime = String(mimeType || '').toLowerCase();
    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (['.svg', '.svgz'].includes(extension) || normalizedMime.includes('svg')) return '';

    if (normalizedMime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) {
        return 'image';
    }
    if (normalizedMime.startsWith('video/') || ['.mp4'].includes(extension)) {
        return 'video';
    }
    if (normalizedMime.startsWith('audio/') || ['.mp3', '.wav'].includes(extension)) {
        return 'audio';
    }
    if (normalizedMime === 'application/octet-stream') {
        return BOARD_UPLOAD_ALLOWED_EXTENSIONS.has(extension) ? 'file' : '';
    }
    if (isBoardUploadMimeAllowed(normalizedMime) || BOARD_UPLOAD_ALLOWED_EXTENSIONS.has(extension)) {
        return 'file';
    }
    return '';
}

function createUploadParser() {
    return multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: BOARD_UPLOAD_MAX_BYTES,
            files: 1,
            fields: 12,
            fieldSize: 256 * 1024,
        },
    }).single('file');
}

function runUploadParser(parser, req, res) {
    return new Promise((resolve, reject) => {
        parser(req, res, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function getDirectorySize(targetDir) {
    let entries;
    try {
        entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    } catch (error) {
        if (error && error.code === 'ENOENT') return 0;
        throw error;
    }

    let total = 0;
    for (const entry of entries) {
        const fullPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            total += await getDirectorySize(fullPath);
        } else if (entry.isFile()) {
            const stat = await fs.promises.stat(fullPath);
            total += stat.size;
        }
    }
    return total;
}

async function getUserUploadSize(uploadRootDir, safeUserId) {
    let buckets;
    try {
        buckets = await fs.promises.readdir(uploadRootDir, { withFileTypes: true });
    } catch (error) {
        if (error && error.code === 'ENOENT') return 0;
        throw error;
    }

    let total = 0;
    for (const bucket of buckets) {
        if (!bucket.isDirectory()) continue;
        total += await getDirectorySize(path.join(uploadRootDir, bucket.name, safeUserId));
    }
    return total;
}

function normalizeBase64Payload(req) {
    const originalName = normalizeUploadText(req.body.fileName || 'board-file');
    const bodyMimeType = normalizeUploadText(req.body.mimeType).toLowerCase();
    const dataUrl = normalizeUploadText(req.body.dataUrl || req.body.data);
    const dataUrlMatch = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    const mimeType = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : bodyMimeType;
    const base64Data = dataUrlMatch ? dataUrlMatch[2] : dataUrl;

    if (!base64Data) return null;

    return {
        originalName,
        mimeType,
        buffer: Buffer.from(base64Data, 'base64'),
    };
}

function createBoardUploadHandler(options = {}) {
    const backendDir = options.backendDir || path.join(__dirname, '..');
    const requireSessionUser = options.requireSessionUser;
    const uploadBucket = sanitizeUploadPathSegment(options.uploadBucket || 'board');
    const uploadParser = createUploadParser();

    if (typeof requireSessionUser !== 'function') {
        throw new Error('createBoardUploadHandler requires requireSessionUser.');
    }

    return async function handleBoardUpload(req, res) {
        const auth = await requireSessionUser(req, res);
        if (!auth) return;
        if (!getAuthUserId(auth)) return res.status(403).json({ success: false, msg: '로그인 정보를 확인해주세요.' });
        if (activeUploads >= 2) {
            res.setHeader('Retry-After', '2');
            return res.status(503).json({ success: false, msg: '다른 파일을 처리 중입니다. 잠시 후 다시 올려주세요.' });
        }
        activeUploads++;
        try { return await handleAuthenticatedUpload(req, res, auth); }
        finally { activeUploads--; }
    };

    async function handleAuthenticatedUpload(req, res, auth) {
        const isMultipart = String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data');

        try {
            if (isMultipart) await runUploadParser(uploadParser, req, res);
        } catch (error) {
            if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, msg: `파일은 ${formatUploadSize(BOARD_UPLOAD_MAX_BYTES)} 이하만 업로드할 수 있습니다.` });
            }
            return res.status(400).json({ success: false, msg: '파일 업로드 요청을 읽을 수 없습니다.' });
        }

        const authUserId = getAuthUserId(auth);
        const expectedUserId = normalizeUploadText(req.body?.userId || req.body?.id);
        if (expectedUserId && authUserId && expectedUserId !== authUserId) {
            return res.status(403).json({ success: false, msg: '본인 계정으로만 파일을 업로드할 수 있습니다.' });
        }

        let payload = null;
        if (req.file) {
            payload = {
                originalName: normalizeUploadText(req.file.originalname || req.body?.fileName || 'board-file'),
                mimeType: normalizeUploadText(req.file.mimetype || req.body?.mimeType || 'application/octet-stream').toLowerCase(),
                buffer: req.file.buffer,
            };
        } else {
            try {
                payload = normalizeBase64Payload(req);
            } catch (error) {
                return res.status(400).json({ success: false, msg: '파일 데이터를 읽을 수 없습니다.' });
            }
        }

        const originalName = payload?.originalName || 'board-file';
        let mimeType = payload?.mimeType || 'application/octet-stream';
        let buffer = payload?.buffer;
        const uploadKind = getBoardUploadKind(mimeType, originalName);
        const uploadLimit = BOARD_UPLOAD_LIMITS[uploadKind] || 0;

        if (!buffer || !buffer.length || !uploadKind) {
            return res.status(400).json({ success: false, msg: '지원하지 않는 파일 형식입니다.' });
        }

        if (buffer.length > uploadLimit) {
            return res.status(400).json({ success: false, msg: `${uploadKind === 'image' ? '이미지' : uploadKind === 'video' ? '영상' : uploadKind === 'audio' ? '오디오' : '파일'}은 ${formatUploadSize(uploadLimit)} 이하만 업로드할 수 있습니다.` });
        }

        try {
            const validated = await validateUploadContent({ buffer, originalName, mimeType }, BOARD_UPLOAD_LIMITS.image);
            buffer = validated.buffer;
            mimeType = validated.mimeType;
            if (req.aborted) throw new UploadContentError('취소된 업로드입니다.');
            const uploadRootDir = path.join(backendDir, 'uploads');
            const safeUserId = sanitizeUploadPathSegment(authUserId);
            const userUploadSize = await getUserUploadSize(uploadRootDir, safeUserId);
            if (userUploadSize + buffer.length > BOARD_UPLOAD_LIMITS.userTotal) {
                return res.status(400).json({ success: false, msg: `사용자별 업로드 총량은 ${formatUploadSize(BOARD_UPLOAD_LIMITS.userTotal)}까지입니다.` });
            }

            const allUploadSize = await getDirectorySize(uploadRootDir);
            if (allUploadSize + buffer.length > BOARD_UPLOAD_LIMITS.allTotal) {
                return res.status(400).json({ success: false, msg: `전체 업로드 저장공간은 ${formatUploadSize(BOARD_UPLOAD_LIMITS.allTotal)}까지입니다.` });
            }

            const uploadDir = path.join(uploadRootDir, uploadBucket, safeUserId);
            await fs.promises.mkdir(uploadDir, { recursive: true });

            const extension = validated.extension;
            const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extension}`;
            const filePath = path.join(uploadDir, fileName);

            await fs.promises.writeFile(filePath, buffer);
            const url = `/uploads/${uploadBucket}/${safeUserId}/${fileName}`;
            try {
                if (options.uploadAccessService) await options.uploadAccessService.recordUpload({ url, ownerId: authUserId, mimeType, size: buffer.length });
            } catch (error) {
                // Only this request's newly created file is removed if metadata cannot be saved.
                await fs.promises.unlink(filePath).catch(() => {});
                throw error;
            }

            return res.json({
                success: true,
                url,
                name: originalName,
                size: buffer.length,
                mimeType,
                kind: uploadKind,
            });
        } catch (error) {
            if (error instanceof UploadContentError) return res.status(error.status).json({ success: false, msg: error.message });
            wgsRuntimeLog("error", "services/boardUploadService.js:300", '게시판 파일 저장 실패:', error.code || 'unknown');
            return res.status(500).json({ success: false, msg: '파일 업로드 중 오류가 발생했습니다.' });
        }
    }
}

module.exports = {
    BOARD_UPLOAD_LIMITS,
    createBoardUploadHandler,
    getBoardUploadKind,
};
