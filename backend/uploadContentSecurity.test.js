'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const sharp = require('sharp'), express = require('express');
const { validateUploadContent, createSafeUploadStatic, UploadContentError } = require('./services/uploadContentSecurity');
const { createBoardUploadHandler } = require('./services/boardUploadService');
const imageLimit = 5 * 1024 * 1024;
const makeImage = format => sharp({ create: { width: 12, height: 8, channels: 3, background: '#4285f4' } }).toFormat(format).toBuffer();

test('raster images are decoded and re-encoded without appended script content', async () => {
    for (const [format, extension, mime] of [['png', '.png', 'image/png'], ['jpeg', '.jpg', 'image/jpeg'], ['gif', '.gif', 'image/gif'], ['webp', '.webp', 'image/webp']]) {
        const buffer = Buffer.concat([await makeImage(format), Buffer.from('<script>untrusted_marker()</script>')]);
        const safe = await validateUploadContent({ buffer, originalName: 'photo' + extension, mimeType: mime }, imageLimit);
        assert.equal(safe.mimeType, mime); assert.equal(safe.kind, 'image');
        assert.equal(safe.buffer.includes(Buffer.from('untrusted_marker')), false);
        const metadata = await sharp(safe.buffer).metadata();
        assert.equal(metadata.width, 12); assert.equal(metadata.height, 8);
    }
});

test('SVG, extension/MIME disguises and malformed rasters are rejected before storage', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>untrusted_marker()</script></svg>');
    const samples = [
        [svg, 'unsafe.svg', 'image/svg+xml'], [svg, 'unsafe.svgz', 'application/octet-stream'],
        [svg, 'unsafe.png', 'image/png'], [await makeImage('png'), 'photo.jpg', 'image/jpeg'],
        [await makeImage('png'), 'photo.png', 'image/jpeg'], [Buffer.from('89504e470d0a1a0a', 'hex'), 'broken.png', 'image/png'],
        [Buffer.from('<html>active</html>'), 'unknown.html', 'text/html'],
    ];
    for (const [buffer, originalName, mimeType] of samples) await assert.rejects(validateUploadContent({ buffer, originalName, mimeType }, imageLimit), UploadContentError);
});

test('high pixel count is rejected even if compressed upload size is small', async () => {
    const buffer = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    assert.ok(buffer.length < imageLimit);
    await assert.rejects(validateUploadContent({ buffer, originalName: 'large.png', mimeType: 'image/png' }, imageLimit), UploadContentError);
});

test('documents and media require matching signatures and canonical response types', async () => {
    for (const [name, mime, buffer] of [
        ['notes.txt', 'text/plain', Buffer.from('학습 메모')], ['data.json', 'application/json', Buffer.from('{"study":true}')],
        ['file.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nsynthetic fixture')],
        ['audio.mp3', 'audio/mpeg', Buffer.from('ID3\x04\0\0synthetic fixture')],
        ['audio.wav', 'audio/wav', Buffer.from('RIFF0000WAVEsynthetic fixture')],
        ['video.mp4', 'video/mp4', Buffer.from('\0\0\0\x18ftypisomsynthetic fixture')],
    ]) {
        const result = await validateUploadContent({ buffer, originalName: name, mimeType: mime }, imageLimit);
        assert.equal(result.mimeType, mime);
    }
    for (const [name, mime] of [['bad.mp4', 'video/mp4'], ['bad.pdf', 'application/pdf'], ['bad.json', 'application/json']]) {
        await assert.rejects(validateUploadContent({ buffer: Buffer.from('<script>bad</script>'), originalName: name, mimeType: mime }, imageLimit), UploadContentError);
    }
});

async function httpFixture(t) {
    const backendDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wgs-upload-test-'));
    const app = express(); app.use(express.json({ limit: '10mb' }));
    const requireSessionUser = async (req, res) => {
        if (req.headers['x-user-id'] !== 'member1' || req.headers['x-session-token'] !== 'test-member-token') {
            res.status(401).json({ success: false }); return null;
        }
        return { user: { id: 'member1' } };
    };
    app.post('/api/upload', createBoardUploadHandler({ backendDir, requireSessionUser, uploadBucket: 'board' }));
    app.use('/uploads', createSafeUploadStatic(path.join(backendDir, 'uploads')));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        assert.equal(path.dirname(backendDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(backendDir).startsWith('wgs-upload-test-'));
        await fs.rm(backendDir, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const auth = { 'x-user-id': 'member1', 'x-session-token': 'test-member-token' };
    const upload = async (buffer, name, mime, json = false) => {
        let body, headers = { ...auth };
        if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify({ fileName: name, mimeType: mime, data: buffer.toString('base64') }); }
        else { body = new FormData(); body.set('file', new Blob([buffer], { type: mime }), name); }
        const response = await fetch(origin + '/api/upload', { method: 'POST', headers, body });
        return { status: response.status, data: await response.json() };
    };
    return { backendDir, origin, auth, upload };
}

test('actual multipart and base64 uploads share validation and authenticate before parsing', async t => {
    const f = await httpFixture(t);
    const anonymous = await fetch(f.origin + '/api/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=broken' }, body: 'malformed' });
    assert.equal(anonymous.status, 401);
    const svg = Buffer.from('<svg><script>bad()</script></svg>');
    for (const json of [false, true]) {
        assert.equal((await f.upload(svg, 'bad.svg', 'image/svg+xml', json)).status, 400);
        assert.equal((await f.upload(svg, 'bad.png', 'image/png', json)).status, 400);
        const uploaded = await f.upload(await makeImage('png'), 'photo.png', 'image/png', json);
        assert.equal(uploaded.status, 200); assert.equal(uploaded.data.mimeType, 'image/png');
        const file = await fetch(f.origin + uploaded.data.url);
        assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /^image\/png/);
        assert.match(file.headers.get('content-security-policy'), /sandbox/);
        assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width, 12);
    }
});

test('old SVG URLs including encoded paths and HEAD/Range cannot execute or bypass blocking', async t => {
    const f = await httpFixture(t);
    const directory = path.join(f.backendDir, 'uploads', 'board', 'member1'); await fs.mkdir(directory, { recursive: true });
    const original = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>');
    await fs.writeFile(path.join(directory, 'old.svg'), original);
    for (const route of ['/uploads/board/member1/old.svg', '/uploads/board/member1/old.s%76g']) {
        for (const method of ['GET', 'HEAD']) assert.equal((await fetch(f.origin + route, { method, headers: { Range: 'bytes=0-100' } })).status, 415);
    }
    assert.deepEqual(await fs.readFile(path.join(directory, 'old.svg')), original, 'existing SVG is preserved on disk');
});

test('text or document files are downloads with script-disabled response headers', async t => {
    const f = await httpFixture(t);
    const uploaded = await f.upload(Buffer.from('<script>not_executable()</script>'), 'notes.txt', 'text/plain');
    assert.equal(uploaded.status, 200);
    const response = await fetch(f.origin + uploaded.data.url);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
});
