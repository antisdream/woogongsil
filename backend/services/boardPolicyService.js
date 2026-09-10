'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');

const crypto = require('node:crypto');
const NOTICE_MARKER = '[[UGONGSIL_BOARD:NOTICE]]';
const FREE_MARKER = '[[UGONGSIL_BOARD:FREE]]';

class BoardPolicyError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

function parseBoardType(value, fallback = 'free') {
    if (value === undefined || value === null || value === '') return fallback;
    const type = String(value).trim().toLowerCase();
    if (!['notice', 'free'].includes(type)) throw new BoardPolicyError('게시판 종류를 확인해주세요.');
    return type;
}

function storedBoardType(post) { return post?.boardType === 'notice' ? 'notice' : 'free'; }

// Used only for migration. Live requests never infer authority from a marker or display name.
function classifyLegacyPost(post) {
    const content = String(post.content || '');
    const noticeMarker = content.includes(NOTICE_MARKER), freeMarker = content.includes(FREE_MARKER);
    if (noticeMarker && freeMarker) return { boardType: 'free', reason: 'conflicting_markers', needsReview: true };
    if (freeMarker) return { boardType: 'free', reason: 'explicit_free_marker', needsReview: false };
    const primaryAuthor = post.authorId === 'skn29' && Number(post.primaryAuthor) === 1;
    const legacyNotice = noticeMarker || Boolean(Number(post.isNotice)) || post.authorName === '관리자';
    if (primaryAuthor && legacyNotice) return { boardType: 'notice', reason: 'verified_primary_legacy_notice', needsReview: false };
    if (legacyNotice) return { boardType: 'free', reason: 'unverified_legacy_notice', needsReview: true };
    return { boardType: 'free', reason: 'legacy_free', needsReview: false };
}

function createBoardPolicyService({ pool }) {
    let schemaPromise;
    async function migrate() {
        let [columns] = await pool.query("SHOW COLUMNS FROM wgs_posts LIKE 'boardType'");
        if (!columns.length) {
            try { await pool.query("ALTER TABLE wgs_posts ADD COLUMN boardType ENUM('notice','free') NULL DEFAULT NULL"); }
            catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
            [columns] = await pool.query("SHOW COLUMNS FROM wgs_posts LIKE 'boardType'");
        }
        // New writes by an older in-flight process fail closed to free while old rows are classified.
        if (columns[0]?.Default !== 'free') await pool.query("ALTER TABLE wgs_posts ALTER COLUMN boardType SET DEFAULT 'free'");
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_board_type_migrations (
            post_id VARCHAR(100) NOT NULL PRIMARY KEY,
            assigned_type ENUM('notice','free') NOT NULL,
            classification_reason VARCHAR(80) NOT NULL,
            needs_review TINYINT NOT NULL DEFAULT 0,
            source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            migrated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
        const db = await pool.getConnection();
        try {
            await db.beginTransaction();
            const [posts] = await db.query(`SELECT p.id,p.content,p.contentJson,p.authorId,p.authorName,p.isNotice,
                COALESCE(u.is_primary_admin,0) AS primaryAuthor
                FROM wgs_posts p LEFT JOIN wgs_users u ON u.id=p.authorId WHERE p.boardType IS NULL FOR UPDATE`);
            for (const post of posts) {
                const classification = classifyLegacyPost(post);
                const sourceHash = crypto.createHash('sha256').update(JSON.stringify([post.content, post.contentJson])).digest('hex');
                await db.query('UPDATE wgs_posts SET boardType = ? WHERE id = ? AND boardType IS NULL', [classification.boardType, post.id]);
                await db.query(`INSERT IGNORE INTO wgs_board_type_migrations
                    (post_id, assigned_type, classification_reason, needs_review, source_hash) VALUES (?, ?, ?, ?, ?)`,
                    [post.id, classification.boardType, classification.reason, classification.needsReview ? 1 : 0, sourceHash]);
            }
            await db.commit();
        } catch (error) { await db.rollback(); throw error; }
        finally { db.release(); }
        if (columns[0]?.Null !== 'NO') await pool.query("ALTER TABLE wgs_posts MODIFY COLUMN boardType ENUM('notice','free') NOT NULL DEFAULT 'free'");
    }
    function ensureSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        if (!schemaPromise) schemaPromise = migrate().catch(error => { schemaPromise = undefined; throw error; });
        return schemaPromise;
    }
    return { ensureSchema };
}

module.exports = { createBoardPolicyService, parseBoardType, storedBoardType, classifyLegacyPost, BoardPolicyError };
