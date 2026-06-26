'use strict';

function createLegacyRankingHistoryHandler({ pool }) {
// 기능: 개인 랭킹 히스토리 조회 API
// 목적: 기존 /api/my-ranking-history 라우트가 DB 컬럼/날짜/사용자ID 차이로 빈 결과를 주는 문제를 보정합니다.
// 주의: 이 블록은 Home.jsx, 달력, CSS를 변경하지 않고 백엔드 API만 보정합니다.
async function wgsB4cQuery(sql, params) {
  params = params || [];

  const clients = [];

  try { if (typeof db !== 'undefined' && db) clients.push(db); } catch (e) {}
  try { if (typeof pool !== 'undefined' && pool) clients.push(pool); } catch (e) {}
  try { if (typeof promisePool !== 'undefined' && promisePool) clients.push(promisePool); } catch (e) {}
  try { if (typeof connection !== 'undefined' && connection) clients.push(connection); } catch (e) {}

  let lastError = null;

  for (const client of clients) {
    try {
      if (client && typeof client.promise === 'function') {
        const [rows] = await client.promise().query(sql, params);
        return rows;
      }

      if (client && typeof client.query === 'function') {
        try {
          return await new Promise((resolve, reject) => {
            const ret = client.query(sql, params, (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });

            if (ret && typeof ret.then === 'function') {
              ret.then((result) => {
                if (Array.isArray(result) && Array.isArray(result[0])) resolve(result[0]);
                else resolve(result);
              }).catch(reject);
            }
          });
        } catch (callbackError) {
          const result = await client.query(sql, params);
          if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
          return result;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('DB 클라이언트를 찾지 못했습니다. db/pool/promisePool/connection 변수 확인 필요');
}

function wgsB4cQuoteName(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function wgsB4cIsoDate(value, fallback) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return fallback;
}

function wgsB4cAddDay(yyyyMMdd) {
  const d = new Date(yyyyMMdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function wgsB4cDatesBetween(startDate, endDate) {
  const result = [];
  let cur = startDate;
  let safety = 0;

  while (cur <= endDate && safety < 370) {
    result.push(cur);
    cur = wgsB4cAddDay(cur);
    safety += 1;
  }

  return result;
}

function wgsB4cTypeWords(type) {
  const raw = String(type || '').trim();
  const lower = raw.toLowerCase();
  const words = new Set();

  if (raw) {
    words.add(raw);
    words.add(lower);
  }

  if (lower.includes('written') || lower.includes('필기')) {
    words.add('written');
    words.add('필기');
  }

  if (lower.includes('ipep') || lower.includes('실기') || lower.includes('practical')) {
    words.add('ipep');
    words.add('practical');
    words.add('실기');
  }

  if (lower.includes('random') || lower.includes('bank') || lower.includes('문제은행') || lower.includes('은행')) {
    words.add('random');
    words.add('bank');
    words.add('문제은행');
    words.add('은행');
  }

  if (lower.includes('past') || lower.includes('기출')) {
    words.add('past');
    words.add('기출');
  }

  return Array.from(words).filter(Boolean).slice(0, 12);
}

async function wgsB4cGetSchema() {
  const rows = await wgsB4cQuery(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME, ORDINAL_POSITION
    `
  );

  const tableMap = {};

  for (const row of rows || []) {
    const table = row.TABLE_NAME;
    if (!tableMap[table]) tableMap[table] = [];
    tableMap[table].push({
      name: row.COLUMN_NAME,
      type: row.DATA_TYPE
    });
  }

  return tableMap;
}

function wgsB4cPickColumns(cols) {
  const names = cols.map((c) => c.name);

  const userCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'user_id' ||
      x === 'userid' ||
      x === 'user' ||
      x === 'username' ||
      x === 'user_name' ||
      x === 'login_id' ||
      x === 'member_id' ||
      x === 'account_id' ||
      x === 'nickname' ||
      x === 'nick' ||
      x === 'writer' ||
      x === 'author' ||
      x.includes('user_id') ||
      x.includes('userid') ||
      x.includes('username') ||
      x.includes('login') ||
      x.includes('member') ||
      x.includes('nickname')
    );
  });

  const dateCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'date' ||
      x === 'day' ||
      x === 'created_at' ||
      x === 'createdat' ||
      x === 'updated_at' ||
      x === 'updatedat' ||
      x === 'solved_at' ||
      x === 'submitted_at' ||
      x === 'completed_at' ||
      x === 'finished_at' ||
      x.includes('date') ||
      x.includes('_at')
    );
  });

  const scoreCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'score' ||
      x === 'point' ||
      x === 'points' ||
      x === 'total_score' ||
      x === 'rank_score' ||
      x.includes('score') ||
      x.includes('point')
    );
  });

  const correctCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'correct' ||
      x === 'correct_count' ||
      x === 'correctcnt' ||
      x === 'correct_answers' ||
      x.includes('correct')
    );
  });

  const totalCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'total' ||
      x === 'total_count' ||
      x === 'question_count' ||
      x === 'solved_count' ||
      x === 'answer_count' ||
      x.includes('total') ||
      x.includes('question_count') ||
      x.includes('solved_count')
    );
  });

  const typeCols = names.filter((n) => {
    const x = n.toLowerCase();
    return (
      x === 'type' ||
      x === 'category' ||
      x === 'mode' ||
      x === 'exam_type' ||
      x === 'question_type' ||
      x === 'quiz_type' ||
      x === 'source' ||
      x.includes('type') ||
      x.includes('category') ||
      x.includes('mode')
    );
  });

  return {
    userCols,
    dateCols,
    scoreCols,
    correctCols,
    totalCols,
    typeCols
  };
}

async function wgsB4cExpandIdentities(initialIdentities, tableMap) {
  const identities = new Set(
    initialIdentities
      .map((v) => String(v || '').trim())
      .filter(Boolean)
  );

  if (identities.size === 0) return [];

  const userTableName = Object.keys(tableMap).find((t) => /^users?$/i.test(t));
  if (!userTableName) return Array.from(identities).slice(0, 20);

  const cols = tableMap[userTableName] || [];
  const searchableCols = cols
    .map((c) => c.name)
    .filter((n) => {
      const x = n.toLowerCase();
      return (
        x.includes('id') ||
        x.includes('name') ||
        x.includes('nick') ||
        x.includes('email') ||
        x.includes('login')
      );
    })
    .slice(0, 12);

  if (searchableCols.length === 0) return Array.from(identities).slice(0, 20);

  const whereParts = [];
  const params = [];

  for (const col of searchableCols) {
    for (const id of identities) {
      whereParts.push(`CAST(${wgsB4cQuoteName(col)} AS CHAR) = ?`);
      params.push(id);
    }
  }

  try {
    const rows = await wgsB4cQuery(
      `SELECT *
      FROM ${wgsB4cQuoteName(userTableName)}
      WHERE ${whereParts.join(' OR ')}
      LIMIT 5
      `,
      params
    );

    for (const row of rows || []) {
      for (const value of Object.values(row)) {
        const text = String(value || '').trim();
        if (text && text.length <= 80) identities.add(text);
      }
    }
  } catch (e) {
    // 사용자 별칭 확장 실패 시 기존 userId만 사용합니다.
  }

  return Array.from(identities).slice(0, 20);
}

async function wgsB4cMyRankingHistoryHandler(req, res) {
  try {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const startDate = wgsB4cIsoDate(req.query.startDate || req.query.start, sevenDaysAgo);
    const endDate = wgsB4cIsoDate(req.query.endDate || req.query.end, todayIso);
    const type = String(req.query.type || req.query.examType || req.query.category || 'written_random').trim();

    const requestedIdentities = [
      req.query.userId,
      req.query.user_id,
      req.query.username,
      req.query.userName,
      req.query.name,
      req.query.nickname,
      req.query.nick,
      req.query.loginId,
      req.query.login_id
    ].filter(Boolean);

    if (requestedIdentities.length === 0) {
      return res.json({
        success: true,
        ok: true,
        reason: 'NO_USER_ID',
        message: '로그인 사용자 정보를 찾지 못했습니다.',
        data: [],
        history: [],
        chartData: [],
        rows: [],
        summary: {
          score: 0,
          maxScore: 0,
          avgScore: 0,
          correctRate: 0,
          records: 0,
          recordDays: 0,
          totalSolved: 0,
          correctCount: 0
        }
      });
    }

    const tableMap = await wgsB4cGetSchema();
    const identities = await wgsB4cExpandIdentities(requestedIdentities, tableMap);
    const typeWords = wgsB4cTypeWords(type);

    const ignoredTablePattern = /^(users?|admins?|sessions?|session|chat|messages?|boards?|posts?|comments?|settings?|site_settings?|page_settings?|calendar|schedules?|holidays?)$/i;

    const candidateTables = [];
    const collected = [];

    for (const [tableName, cols] of Object.entries(tableMap)) {
      if (ignoredTablePattern.test(tableName)) continue;

      const picked = wgsB4cPickColumns(cols);

      if (picked.userCols.length === 0) continue;
      if (picked.dateCols.length === 0) continue;
      if (
        picked.scoreCols.length === 0 &&
        picked.correctCols.length === 0 &&
        picked.totalCols.length === 0
      ) {
        continue;
      }

      const userCols = picked.userCols.slice(0, 4);
      const dateCol = picked.dateCols[0];
      const scoreCol = picked.scoreCols[0] || null;
      const correctCol = picked.correctCols[0] || null;
      const totalCol = picked.totalCols[0] || null;
      const typeCol = picked.typeCols[0] || null;

      candidateTables.push({
        table: tableName,
        userCols,
        dateCol,
        scoreCol,
        correctCol,
        totalCol,
        typeCol
      });

      const params = [];
      const whereParts = [];

      whereParts.push(`DATE(${wgsB4cQuoteName(dateCol)}) BETWEEN ? AND ?`);
      params.push(startDate, endDate);

      const userWhere = [];
      for (const userCol of userCols) {
        for (const identity of identities) {
          userWhere.push(`CAST(${wgsB4cQuoteName(userCol)} AS CHAR) = ?`);
          params.push(identity);
        }
      }

      if (userWhere.length >0) {
        whereParts.push(`(${userWhere.join(' OR ')})`);
      }

      if (typeCol && typeWords.length >0) {
        const typeWhere = [];
        for (const word of typeWords) {
          typeWhere.push(`LOWER(CAST(${wgsB4cQuoteName(typeCol)} AS CHAR)) LIKE ?`);
          params.push(`%${String(word).toLowerCase()}%`);
        }
        whereParts.push(`(${typeWhere.join(' OR ')})`);
      }

      const scoreExpr = scoreCol
        ? `MAX(COALESCE(CAST(${wgsB4cQuoteName(scoreCol)} AS DECIMAL(12,2)), 0))`
        : correctCol
          ? `MAX(COALESCE(CAST(${wgsB4cQuoteName(correctCol)} AS DECIMAL(12,2)), 0) * 5)`
          : `0`;

      const correctExpr = correctCol
        ? `SUM(COALESCE(CAST(${wgsB4cQuoteName(correctCol)} AS DECIMAL(12,2)), 0))`
        : `0`;

      const totalExpr = totalCol
        ? `SUM(COALESCE(CAST(${wgsB4cQuoteName(totalCol)} AS DECIMAL(12,2)), 0))`
        : `0`;

      const sql = `SELECT
          DATE(${wgsB4cQuoteName(dateCol)}) AS day,
          ${scoreExpr} AS score,
          ${correctExpr} AS correctCount,
          ${totalExpr} AS totalCount,
          COUNT(*) AS recordCount,
          '${String(tableName).replace(/'/g, "''")}'AS sourceTable
        FROM ${wgsB4cQuoteName(tableName)}
        WHERE ${whereParts.join(' AND ')}
          AND DATE(${wgsB4cQuoteName(dateCol)}) IS NOT NULL
        GROUP BY DATE(${wgsB4cQuoteName(dateCol)})
        ORDER BY DATE(${wgsB4cQuoteName(dateCol)})
      `;

      try {
        const rows = await wgsB4cQuery(sql, params);
        for (const row of rows || []) {
          collected.push(row);
        }
      } catch (e) {
        // 후보 테이블 하나가 실패해도 전체 API는 계속 진행합니다.
      }
    }

    const merged = new Map();

    for (const row of collected) {
      const day = String(row.day || '').slice(0, 10);
      if (!day) continue;

      const current = merged.get(day) || {
        date: day,
        label: day.slice(5),
        score: 0,
        correctCount: 0,
        totalCount: 0,
        recordCount: 0
      };

      current.score = Math.max(Number(current.score || 0), Number(row.score || 0));
      current.correctCount += Number(row.correctCount || 0);
      current.totalCount += Number(row.totalCount || 0);
      current.recordCount += Number(row.recordCount || 0);

      merged.set(day, current);
    }

    const dates = wgsB4cDatesBetween(startDate, endDate);

    const points = dates.map((day) => {
      const item = merged.get(day) || {
        date: day,
        label: day.slice(5),
        score: 0,
        correctCount: 0,
        totalCount: 0,
        recordCount: 0
      };

      const correctRate = item.totalCount >0
        ? Math.round((item.correctCount / item.totalCount) * 100)
        : 0;

      return {
        date: item.date,
        day: item.date,
        label: item.label,
        score: Number(item.score || 0),
        correctRate,
        accuracy: correctRate,
        correctCount: Number(item.correctCount || 0),
        totalCount: Number(item.totalCount || 0),
        totalSolved: Number(item.totalCount || 0),
        recordCount: Number(item.recordCount || 0)
      };
    });

    const activePoints = points.filter((p) => p.recordCount >0 || p.score >0);
    const maxScore = points.reduce((max, p) => Math.max(max, Number(p.score || 0)), 0);
    const totalScore = points.reduce((sum, p) => sum + Number(p.score || 0), 0);
    const totalCorrect = points.reduce((sum, p) => sum + Number(p.correctCount || 0), 0);
    const totalSolved = points.reduce((sum, p) => sum + Number(p.totalCount || 0), 0);
    const totalRecords = points.reduce((sum, p) => sum + Number(p.recordCount || 0), 0);
    const correctRate = totalSolved >0 ? Math.round((totalCorrect / totalSolved) * 100) : 0;

    return res.json({
      success: true,
      ok: true,
      type,
      startDate,
      endDate,
      data: points,
      history: points,
      chartData: points,
      rows: points,
      summary: {
        score: maxScore,
        maxScore,
        avgScore: points.length >0 ? Math.round(totalScore / points.length) : 0,
        correctRate,
        accuracy: correctRate,
        records: totalRecords,
        recordDays: activePoints.length,
        days: activePoints.length,
        totalSolved,
        correctCount: totalCorrect
      },
      debug: {
        candidateTableCount: candidateTables.length,
        matchedRowCount: collected.length,
        matchedDayCount: activePoints.length,
        candidateTables: candidateTables.slice(0, 20)
      }
    });
  } catch (err) {
    console.error('[WGS_STEP_B4C_MY_RANKING_HISTORY_ERROR]', err);
    return res.status(500).json({
      success: false,
      ok: false,
      message: '개인 랭킹 히스토리 조회 중 오류가 발생했습니다.',
      error: err.message
    });
  }
}

  return wgsB4cMyRankingHistoryHandler;
}

module.exports = {
  createLegacyRankingHistoryHandler,
};
