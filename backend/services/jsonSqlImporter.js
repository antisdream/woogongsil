'use strict';

const fs = require('fs');

function createJsonSqlImporter({
    pool,
    bcrypt,
    saltRounds,
    userFile,
    postsFile,
    rankingRandomFile,
    rankingDataFile,
    rankingPastFile,
    readJSON,
    normalizeToMysqlDateTime,
    getBoardDateString
} = {}) {
    if (!pool) throw new Error('createJsonSqlImporter requires mysql pool');
    if (!bcrypt) throw new Error('createJsonSqlImporter requires bcrypt');
    if (typeof readJSON !== 'function') throw new Error('createJsonSqlImporter requires readJSON');
    if (typeof normalizeToMysqlDateTime !== 'function') throw new Error('createJsonSqlImporter requires normalizeToMysqlDateTime');
    if (typeof getBoardDateString !== 'function') throw new Error('createJsonSqlImporter requires getBoardDateString');

    const SALT_ROUNDS = saltRounds;
    const USER_FILE = userFile;
    const POSTS_FILE = postsFile;
    const RANKING_RANDOM_FILE = rankingRandomFile;
    const RANKING_DATA_FILE = rankingDataFile;
    const RANKING_PAST_FILE = rankingPastFile;

// 4. JSON ->SQL 자동 복구
// - SQL 테이블이 비어 있거나 초기 상태일 때만 기존 JSON 데이터를 가져옵니다.
// - 사용자 이메일은 인증 기능과 직결되므로, SQL에 누락되어 있으면 보정합니다.
async function importUsersFromJSON() {
    if (!fs.existsSync(USER_FILE)) return;

    const usersData = readJSON(USER_FILE, {});
    const entries = Object.entries(usersData);
    if (entries.length === 0) return;

    const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_users');
    const shouldImportAll = Number(countRows[0].cnt) <= 1;

    if (shouldImportAll) console.log('users_data.json ->wgs_users 복구 시작');

    for (const [id, user] of entries) {
        if (!id || !user) continue;

        let password = user.password || '';
        if (password && !String(password).startsWith('$2')) {
            password = await bcrypt.hash(String(password), SALT_ROUNDS);
        }

        if (!password) continue;

        const name = user.name || id;
        const email = user.email ? String(user.email).trim().toLowerCase() : null;
        const dDay = user.dDay || null;

        if (shouldImportAll) {
            await pool.query(
                `INSERT INTO wgs_users (id, password, name, email, dDay, sessionToken)
                 VALUES (?, ?, ?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    email = VALUES(email),
                    dDay = COALESCE(VALUES(dDay), dDay)`,
                [id, password, name, email, dDay]
            );
        } else if (email) {
            await pool.query(
                `UPDATE wgs_users
                 SET email = ?, name = COALESCE(NULLIF(name, ''), ?)
                 WHERE id = ? AND (email IS NULL OR email = '' OR email <>?)`,
                [email, name, id, email]
            );
        }

        if (Array.isArray(user.loginHistory) && user.loginHistory.length >0) {
            const [historyCount] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_login_history WHERE userId = ?', [id]);

            if (Number(historyCount[0].cnt) === 0) {
                for (const item of user.loginHistory.slice(0, 50)) {
                    const time = normalizeToMysqlDateTime(item.time || item);
                    const action = item.action || (String(item).includes('로그아웃') ? '로그아웃' : '로그인');
                    await pool.query('INSERT INTO wgs_login_history (userId, time, action) VALUES (?, ?, ?)', [id, time, action]);
                }
            }
        }

        if (Array.isArray(user.fortuneHistory) && user.fortuneHistory.length >0) {
            const [fortuneCount] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_fortune_history WHERE userId = ?', [id]);

            if (Number(fortuneCount[0].cnt) === 0) {
                for (const item of user.fortuneHistory.slice(0, 10)) {
                    await pool.query(
                        'INSERT INTO wgs_fortune_history (userId, time, type, data) VALUES (?, ?, ?, ?)',
                        [id, normalizeToMysqlDateTime(item.time), item.type || 'unknown', JSON.stringify(item.data || {})]
                    );
                }
            }
        }

        if (Array.isArray(user.wrongNotes) && user.wrongNotes.length >0) {
            for (const note of user.wrongNotes) {
                if (!note.question_id) continue;

                const [exists] = await pool.query(
                    'SELECT id FROM wgs_wrong_notes WHERE userId = ? AND question_id = ? LIMIT 1',
                    [id, note.question_id]
                );

                if (exists.length === 0) {
                    await pool.query(
                        `INSERT INTO wgs_wrong_notes (userId, question_id, source, year, session, savedAt)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            id,
                            note.question_id,
                            note.source || 'random',
                            note.year || null,
                            note.session || null,
                            normalizeToMysqlDateTime(note.savedAt)
                        ]
                    );
                }
            }
        }
    }

    if (shouldImportAll) console.log(' 유저 데이터 복구 완료');
}

async function importPostsFromJSON() {
    if (!fs.existsSync(POSTS_FILE)) return;

    const [postRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_posts');
    if (Number(postRows[0].cnt) >0) return;

    const posts = readJSON(POSTS_FILE, []);
    if (!Array.isArray(posts) || posts.length === 0) return;

    console.log('posts_data.json -> 게시판 테이블 복구 시작');

    for (const post of posts) {
        if (!post.id) continue;

        const [authorRows] = await pool.query('SELECT id FROM wgs_users WHERE id = ? LIMIT 1', [post.authorId]);
        const safeAuthorId = authorRows.length >0 ? post.authorId : null;

        await pool.query(
            `INSERT IGNORE INTO wgs_posts (id, title, content, authorId, authorName, date, views, likes, isNotice)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(post.id),
                post.title || '',
                post.content || '',
                safeAuthorId,
                post.authorName || '알 수 없음',
                post.date || getBoardDateString(),
                Number(post.views || 0),
                Number(post.likes || 0),
                post.isNotice ? 1 : 0
            ]
        );

        if (Array.isArray(post.comments)) {
            for (const comment of post.comments) {
                if (!comment.id) continue;

                await pool.query(
                    `INSERT IGNORE INTO wgs_comments (id, postId, text, authorId, authorName, date)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        String(comment.id),
                        String(post.id),
                        comment.text || '',
                        comment.authorId || null,
                        comment.authorName || '알 수 없음',
                        comment.date || getBoardDateString()
                    ]
                );

                if (Array.isArray(comment.replies)) {
                    for (const reply of comment.replies) {
                        if (!reply.id) continue;

                        await pool.query(
                            `INSERT IGNORE INTO wgs_replies (id, commentId, text, authorId, authorName, date)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                String(reply.id),
                                String(comment.id),
                                reply.text || '',
                                reply.authorId || null,
                                reply.authorName || '알 수 없음',
                                reply.date || getBoardDateString()
                            ]
                        );
                    }
                }
            }
        }

        if (Array.isArray(post.likedUsers)) {
            for (const likedUserId of post.likedUsers) {
                await pool.query(
                    'INSERT IGNORE INTO wgs_post_likes (postId, userId) VALUES (?, ?)',
                    [String(post.id), String(likedUserId)]
                );
            }
        }
    }

    console.log(' 게시판 데이터 복구 완료');
}

async function importRankingsFromJSON() {
    const randomSources = [RANKING_RANDOM_FILE, RANKING_DATA_FILE];

    const [randomCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_ranking_random');
    if (Number(randomCountRows[0].cnt) === 0) {
        for (const filePath of randomSources) {
            const rows = readJSON(filePath, []);
            if (!Array.isArray(rows)) continue;

            for (const item of rows) {
                if (!item.userId || !item.date) continue;

                await pool.query(
                    `INSERT INTO wgs_ranking_random (userId, date, solved_count, correct_count)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        solved_count = VALUES(solved_count),
                        correct_count = VALUES(correct_count)`,
                    [item.userId, item.date, Number(item.solved_count || 0), Number(item.correct_count || 0)]
                );
            }
        }
    }

    const [pastCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_ranking_past');
    if (Number(pastCountRows[0].cnt) === 0) {
        const rows = readJSON(RANKING_PAST_FILE, []);

        if (Array.isArray(rows)) {
            for (const item of rows) {
                if (!item.userId || !item.date) continue;

                await pool.query(
                    `INSERT INTO wgs_ranking_past (userId, date, year, session, solved_count, correct_count)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        solved_count = VALUES(solved_count),
                        correct_count = VALUES(correct_count)`,
                    [
                        item.userId,
                        item.date,
                        Number(item.year || 0),
                        Number(item.session || 0),
                        Number(item.solved_count || 0),
                        Number(item.correct_count || 0)
                    ]
                );
            }
        }
    }
}

async function importDataFromJSON() {
    try {
        await importUsersFromJSON();
        await importPostsFromJSON();
        await importRankingsFromJSON();
    } catch (error) {
        console.error('JSON ->SQL 자동 복구 중 오류:', error.message);
    }
}


    return {
        importDataFromJSON
    };
}

module.exports = {
    createJsonSqlImporter
};
