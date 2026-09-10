'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');

const fs = require('node:fs/promises');
const path = require('node:path');
const { MIME_BY_EXTENSION, safeUploadHeaders, guardUploadPath } = require('./uploadContentSecurity');

class UploadAccessError extends Error {
    constructor(message = '첨부파일을 사용할 권한이 없습니다.', status = 403) { super(message); this.status = status; }
}

function createUploadAccessService({ pool, backendDir, env = process.env }) {
    const uploadRoot = path.resolve(backendDir, 'uploads');
    const origins = new Set(['https://woogongsil.site', 'https://www.woogongsil.site', ...String(env.PUBLIC_SITE_URL || '').split(',')].filter(Boolean));
    let schemaPromise;

    function normalizedUrl(value) {
        if (typeof value !== 'string') return null;
        let pathname;
        if (value.startsWith('/uploads/')) pathname = value.split(/[?#]/)[0];
        else {
            try { const parsed = new URL(value); if (!origins.has(parsed.origin)) return null; pathname = parsed.pathname; }
            catch (_) { return null; }
        }
        try { pathname = decodeURIComponent(pathname); } catch (_) { return null; }
        return /^\/uploads\/(board|study)\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}$/.test(pathname) ? pathname : null;
    }

    function documentUrls(content, contentJson) {
        const result = new Set();
        const scanText = value => {
            for (const match of String(value || '').matchAll(/(?:https?:\/\/[^\s"'<>()[\]\\]+)?\/uploads\/[^\s"'<>()[\]\\]+/g)) {
                const normalized = normalizedUrl(match[0]); if (normalized) result.add(normalized);
            }
        };
        scanText(content);
        let doc;
        try { doc = typeof contentJson === 'string' ? JSON.parse(contentJson || 'null') : contentJson; }
        catch (_) { throw new UploadAccessError('에디터 데이터 형식을 확인해주세요.', 400); }
        let nodes = 0;
        const visit = (value, depth = 0) => {
            if (++nodes > 30000 || depth > 30) throw new UploadAccessError('문서 구조가 너무 큽니다.', 400);
            if (typeof value === 'string') scanText(value);
            else if (value && typeof value === 'object') {
                if (typeof value.url === 'string' && value.url.startsWith('blob:')) throw new UploadAccessError('임시 파일 주소는 저장할 수 없습니다. 파일을 다시 첨부해주세요.', 400);
                for (const child of Object.values(value)) visit(child, depth + 1);
            }
        };
        visit(doc);
        if (result.size > 64) throw new UploadAccessError('문서 한 개에는 첨부파일을 64개까지 넣을 수 있습니다.', 400);
        return [...result].sort();
    }

    async function migrate() {
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_uploads (
            url_path VARCHAR(500) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            owner_id VARCHAR(100) NOT NULL,
            mime_type VARCHAR(120) NOT NULL,
            byte_size BIGINT UNSIGNED NOT NULL,
            content_checked TINYINT NOT NULL DEFAULT 0,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            INDEX idx_wgs_uploads_owner(owner_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_upload_references (
            url_path VARCHAR(500) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            resource_type ENUM('board','study') NOT NULL,
            resource_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            PRIMARY KEY(url_path,resource_type,resource_id),
            INDEX idx_wgs_upload_resource(resource_type,resource_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    function ensureSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        if (!schemaPromise) schemaPromise = migrate().catch(error => { schemaPromise = undefined; throw error; });
        return schemaPromise;
    }

    async function recordUpload({ url, ownerId, mimeType, size }) {
        const normalized = normalizedUrl(url);
        if (!normalized) throw new UploadAccessError('첨부파일 경로가 올바르지 않습니다.', 400);
        await pool.query('INSERT INTO wgs_uploads (url_path,owner_id,mime_type,byte_size,content_checked) VALUES (?,?,?,?,1)', [normalized, ownerId, mimeType, size]);
    }

    async function assertReferences(db, { resourceType, resourceId, actorId, content, contentJson }) {
        const urls = documentUrls(content, contentJson);
        for (const url of urls) {
            const [[upload]] = await db.query('SELECT owner_id FROM wgs_uploads WHERE url_path = ?', [url]);
            if (!upload) throw new UploadAccessError();
            if (upload.owner_id === actorId) continue;
            const [existing] = resourceId ? await db.query('SELECT 1 FROM wgs_upload_references WHERE url_path = ? AND resource_type = ? AND resource_id = ?', [url, resourceType, String(resourceId)]) : [[]];
            if (!existing.length) throw new UploadAccessError();
        }
        return urls;
    }

    // File references and the document's visibility/content change in the same transaction.
    async function mutateDocument({ resourceType, resourceId, actorId }, action) {
        if (!['board', 'study'].includes(resourceType)) throw new UploadAccessError('문서 종류가 올바르지 않습니다.', 400);
        const db = await pool.getConnection();
        try {
            await db.beginTransaction();
            const table = resourceType === 'board' ? 'wgs_posts' : 'wgs_study_documents';
            const [[existing]] = resourceId ? await db.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [resourceId]) : [[]];
            const changed = await action(db, existing || null);
            const id = String(changed.resourceId || resourceId);
            const urls = await assertReferences(db, { resourceType, resourceId, actorId, content: changed.content, contentJson: changed.contentJson });
            await db.query('DELETE FROM wgs_upload_references WHERE resource_type = ? AND resource_id = ?', [resourceType, id]);
            for (const url of urls) await db.query('INSERT INTO wgs_upload_references (url_path,resource_type,resource_id) VALUES (?,?,?)', [url, resourceType, id]);
            await db.commit();
            return changed.result;
        } catch (error) { await db.rollback(); throw error; }
        finally { db.release(); }
    }

    // Run during the release migration. Existing bytes are retained; ambiguous ownership stays private.
    async function migrateLegacyFiles() {
        await ensureSchema();
        const [users] = await pool.query('SELECT id FROM wgs_users');
        const bySegment = new Map();
        for (const { id } of users) {
            const segment = String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
            bySegment.set(segment, bySegment.has(segment) ? null : id);
        }
        let added = 0, ambiguous = 0;
        for (const bucket of ['board', 'study']) {
            let dirs; try { dirs = await fs.readdir(path.join(uploadRoot, bucket), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            for (const directory of dirs) {
                if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
                const owner = bySegment.get(directory.name);
                if (!owner) { ambiguous++; continue; }
                for (const file of await fs.readdir(path.join(uploadRoot, bucket, directory.name), { withFileTypes: true })) {
                    if (!file.isFile() || file.isSymbolicLink()) continue;
                    const url = normalizedUrl(`/uploads/${bucket}/${directory.name}/${file.name}`);
                    if (!url) { ambiguous++; continue; }
                    const stat = await fs.stat(path.join(uploadRoot, bucket, directory.name, file.name));
                    const [result] = await pool.query('INSERT IGNORE INTO wgs_uploads (url_path,owner_id,mime_type,byte_size,content_checked) VALUES (?,?,?,?,0)', [url, owner, MIME_BY_EXTENSION[path.extname(file.name).toLowerCase()] || 'application/octet-stream', stat.size]);
                    added += result.affectedRows;
                }
            }
        }
        for (const [resourceType, table, ownerField] of [['board', 'wgs_posts', 'authorId'], ['study', 'wgs_study_documents', 'ownerId']]) {
            let offset = 0;
            for (;;) {
                const [docs] = await pool.query(`SELECT id,${ownerField} AS owner_id,content,contentJson FROM ${table} ORDER BY id LIMIT 100 OFFSET ?`, [offset]);
                for (const doc of docs) {
                    const urls = documentUrls(doc.content, doc.contentJson);
                    for (const url of urls) await pool.query(`INSERT IGNORE INTO wgs_upload_references (url_path,resource_type,resource_id)
                        SELECT url_path,?,? FROM wgs_uploads WHERE url_path = ? AND owner_id = ?`, [resourceType, String(doc.id), url, doc.owner_id]);
                }
                if (docs.length < 100) break;
                offset += 100;
            }
        }
        return { added, ambiguous };
    }

    async function canRead(url, viewerId) {
        const [[upload]] = await pool.query('SELECT owner_id FROM wgs_uploads WHERE url_path = ?', [url]);
        if (!upload) return false;
        if (viewerId && upload.owner_id === viewerId) return true;
        const [notices] = await pool.query(`SELECT 1 FROM wgs_upload_references r JOIN wgs_posts p ON BINARY p.id = BINARY r.resource_id
            WHERE r.url_path = ? AND r.resource_type = 'board' AND (p.boardType = 'notice' OR ? = 1) LIMIT 1`, [url, viewerId ? 1 : 0]);
        if (notices.length) return true;
        if (!viewerId) return false;
        const [docs] = await pool.query(`SELECT 1 FROM wgs_upload_references r JOIN wgs_study_documents d ON d.id = r.resource_id
            WHERE r.url_path = ? AND r.resource_type = 'study' AND (d.visibility = 'public' OR d.ownerId = ?) LIMIT 1`, [url, viewerId]);
        return docs.length > 0;
    }

    function serve(validateSession) {
        return async (req, res, next) => {
            if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
            res.setHeader('Cache-Control', 'private, no-store, max-age=0');
            res.setHeader('Vary', 'Cookie, X-User-Id, X-Session-Token');
            const url = normalizedUrl('/uploads' + req.path);
            if (!url) return res.status(404).end();
            let accepted = false;
            guardUploadPath(req, res, () => { accepted = true; });
            if (!accepted) return;
            try {
                const auth = await validateSession(req);
                const viewerId = auth?.valid ? String(auth.user?.id || auth.id || '') : '';
                if (!(await canRead(url, viewerId))) return res.status(404).end();
                const filename = path.resolve(uploadRoot, url.slice('/uploads/'.length));
                const actual = await fs.realpath(filename), actualRoot = await fs.realpath(uploadRoot);
                if (!actual.startsWith(actualRoot + path.sep)) return res.status(404).end();
                safeUploadHeaders(res, filename);
                return res.sendFile(filename, { cacheControl: false, lastModified: false, etag: false }, error => { if (error && !res.headersSent) res.status(error.statusCode || 404).end(); });
            } catch (error) {
                if (['ENOENT', 'ENOTDIR'].includes(error.code)) return res.status(404).end();
                return next(error);
            }
        };
    }

    return { ensureSchema, recordUpload, documentUrls, normalizedUrl, assertReferences, mutateDocument, migrateLegacyFiles, canRead, serve };
}

module.exports = { createUploadAccessService, UploadAccessError };
