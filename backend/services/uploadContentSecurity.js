'use strict';

const path = require('node:path');
const express = require('express');
const sharp = require('sharp');

// Bound image work for the existing 2 GB host; this is shared by board and study uploads.
sharp.cache({ memory: 16, files: 0, items: 0 });
sharp.concurrency(1);
const MAX_IMAGE_PIXELS = 16 * 1000 * 1000;
const MAX_IMAGE_PAGES = 120;
const IMAGE_FORMATS = { jpeg: { extensions: ['.jpg', '.jpeg'], mime: 'image/jpeg' },
    png: { extensions: ['.png'], mime: 'image/png' }, gif: { extensions: ['.gif'], mime: 'image/gif' },
    webp: { extensions: ['.webp'], mime: 'image/webp' } };
const MIME_BY_EXTENSION = Object.freeze({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.hwp': 'application/x-hwp',
});
const ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'audio/x-wav': 'audio/wav',
    'application/x-zip-compressed': 'application/zip', 'application/haansofthwp': 'application/x-hwp' };

class UploadContentError extends Error {
    constructor(message = '파일 내용과 형식을 확인해주세요.', status = 400) { super(message); this.status = status; }
}

function imageSignature(buffer) {
    if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
    if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
    return null;
}

function extensionFor(originalName, mimeType) {
    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (extension) return extension;
    return Object.keys(MIME_BY_EXTENSION).find(key => MIME_BY_EXTENSION[key] === mimeType) || '';
}

async function validateUploadContent({ buffer, originalName, mimeType }, imageLimit) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new UploadContentError();
    const suppliedMime = ALIASES[mimeType] || String(mimeType || '').toLowerCase();
    const extension = extensionFor(originalName, suppliedMime);
    if (['.svg', '.svgz'].includes(extension) || suppliedMime.includes('svg')) {
        throw new UploadContentError('SVG는 지원하지 않습니다. PNG·JPG·WebP 이미지로 변환해 올려주세요.');
    }
    const expectedMime = MIME_BY_EXTENSION[extension];
    if (!expectedMime || (suppliedMime && suppliedMime !== 'application/octet-stream' && suppliedMime !== expectedMime)) {
        throw new UploadContentError('파일 확장자와 실제 형식이 일치해야 합니다.');
    }
    if (expectedMime.startsWith('image/')) {
        const signature = imageSignature(buffer);
        if (!signature || !IMAGE_FORMATS[signature].extensions.includes(extension)) throw new UploadContentError('정상적인 PNG·JPG·GIF·WebP 이미지만 올릴 수 있습니다.');
        if (buffer.length > imageLimit) throw new UploadContentError('이미지는 5MB 이하만 올릴 수 있습니다.');
        try {
            const input = { animated: true, failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, limitInputChannels: 4 };
            const metadata = await sharp(buffer, input).metadata();
            const pages = metadata.pages || 1;
            const pixels = metadata.width * (metadata.pageHeight || metadata.height) * pages;
            if (metadata.format !== signature || !Number.isFinite(pixels) || pixels <= 0 || pixels > MAX_IMAGE_PIXELS
                || pages > MAX_IMAGE_PAGES || (pages > 1 && !['gif', 'webp'].includes(signature))) {
                throw new UploadContentError('이미지의 해상도나 애니메이션 길이를 줄여주세요.');
            }
            // Decode/re-encode strips metadata and appended executable content. SVG is never decoded.
            const safeBuffer = await sharp(buffer, { ...input, autoOrient: true }).toFormat(signature)
                .timeout({ seconds: 5 }).toBuffer();
            if (safeBuffer.length > imageLimit) throw new UploadContentError('안전하게 변환한 이미지가 5MB를 넘습니다. 크기를 줄여주세요.');
            return { buffer: safeBuffer, mimeType: expectedMime, extension, kind: 'image' };
        } catch (error) {
            if (error instanceof UploadContentError) throw error;
            throw new UploadContentError('이미지를 읽을 수 없거나 처리 한도를 넘었습니다. 크기를 줄여 다시 올려주세요.');
        }
    }
    const prefix = buffer.subarray(0, 12);
    const zip = buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) || buffer.subarray(0, 4).equals(Buffer.from('504b0506', 'hex'));
    const ole = buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    let valid = false;
    if (extension === '.pdf') valid = prefix.subarray(0, 5).toString('ascii') === '%PDF-';
    if (['.zip', '.docx', '.xlsx', '.pptx'].includes(extension)) valid = zip;
    if (['.doc', '.xls', '.ppt', '.hwp'].includes(extension)) valid = ole;
    if (extension === '.mp4') valid = prefix.subarray(4, 8).toString('ascii') === 'ftyp';
    if (extension === '.mp3') valid = prefix.subarray(0, 3).toString('ascii') === 'ID3' || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0);
    if (extension === '.wav') valid = prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WAVE';
    if (['.txt', '.csv'].includes(extension)) valid = !buffer.includes(0);
    if (extension === '.json') {
        try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); valid = true; } catch (_) { valid = false; }
    }
    if (!valid) throw new UploadContentError('파일 내용과 확장자가 일치하지 않거나 손상된 파일입니다.');
    const kind = expectedMime.startsWith('video/') ? 'video' : expectedMime.startsWith('audio/') ? 'audio' : 'file';
    return { buffer, mimeType: expectedMime, extension, kind };
}

function safeUploadHeaders(res, filePath) {
    const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const inline = /^(image|audio|video)\//.test(mime);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
}

function guardUploadPath(req, res, next) {
    let decoded;
    try { decoded = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
    if (!MIME_BY_EXTENSION[path.extname(decoded).toLowerCase()]) return res.status(415).end();
    return next();
}

function createSafeUploadStatic(root) {
    const router = express.Router();
    router.use(guardUploadPath);
    router.use(express.static(root, { index: false, dotfiles: 'deny', fallthrough: false, setHeaders: safeUploadHeaders }));
    router.use((error, _req, res, _next) => res.status(error.status || 500).end());
    return router;
}

module.exports = { validateUploadContent, UploadContentError, safeUploadHeaders, guardUploadPath, createSafeUploadStatic, MIME_BY_EXTENSION, MAX_IMAGE_PIXELS };
