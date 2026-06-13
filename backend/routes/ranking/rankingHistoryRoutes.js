// 사용자별 랭킹 이력 API를 제공합니다.
'use strict';

const path = require('path');

function registerRankingHistoryRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const fs = options.fs || require('fs');
    const backendDir = options.backendDir || path.resolve(__dirname, '..', '..');
    const RANKING_DATA_FILE = options.rankingDataFile || path.join(backendDir, 'ranking_data.json');
    const IPEP_RANKING_FILE = options.ipepRankingFile || path.join(backendDir, 'ipep_rankings.json');
    const getSeasonStatus = typeof options.getSeasonStatus === 'function'? options.getSeasonStatus
        : () => ({ rankingDate: new Date().toISOString().slice(0, 10) });

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerRankingHistoryRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerRankingHistoryRoutes requires a MySQL pool.');
    }
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


// 개인 랭킹 이력 조회 라우트입니다.
// 프론트엔드가 호출하는 랭킹 이력 API를 DB 랭킹 테이블과 연결합니다.
// 동일한 응답 구조를 유지해 달력, 홈 화면, 랭킹 화면에서 같은 데이터를 사용할 수 있도록 합니다.
// userId가 로그인 ID, 이름, 닉네임 중 하나로 전달되어도 users 테이블 후보값을 확장해 매칭합니다.

function wgsB4gNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function wgsB4gDateOnly(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function wgsB4gIdent(name) {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

function wgsB4gPickColumn(fields, patterns) {
  const lowerMap = new Map(fields.map((f) => [String(f).toLowerCase(), f]));

  for (const p of patterns) {
    const exact = lowerMap.get(String(p).toLowerCase());
    if (exact) return exact;
  }

  for (const f of fields) {
    const lf = String(f).toLowerCase();
    for (const p of patterns) {
      const lp = String(p).toLowerCase();
      if (lf.includes(lp)) return f;
    }
  }

  return "";
}

function wgsB4gNormalizeType(rawType) {
  const t = String(rawType || "").trim().toLowerCase();

  const isIpep =
    t.includes("ipep") ||
    t.includes("practical") ||
    t.includes("실기");

  const isPast =
    t.includes("past") ||
    t.includes("기출");

  if (isIpep && isPast) return "ipep_past";
  if (isIpep) return "ipep_random";
  if (isPast) return "past";
  return "random";
}

async function wgsB4gTableExists(tableName) {
  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [tableName]
    );
    return wgsB4gNum(rows?.[0]?.cnt) >0;
  } catch (err) {
    console.warn("[WGS B4G] table exists check failed:", tableName, err.message);
    return false;
  }
}

async function wgsB4gGetUserCandidates(rawUserId) {
  const set = new Set();

  const add = (v) => {
    const value = String(v ?? "").trim();
    if (value) set.add(value);
  };

  add(rawUserId);

  if (!rawUserId) return [];

  try {
    if (!(await wgsB4gTableExists("users"))) {
      return Array.from(set);
    }

    const [cols] = await pool.query("SHOW COLUMNS FROM `users`");
    const fields = cols.map((c) => c.Field);

    const searchable = fields.filter((f) => {
      const lf = String(f).toLowerCase();
      return (
        lf === "id" ||
        lf.includes("userid") ||
        lf.includes("user_id") ||
        lf.includes("login") ||
        lf.includes("name") ||
        lf.includes("nick") ||
        lf.includes("email")
      );
    });

    if (!searchable.length) return Array.from(set);

    const where = searchable
      .map((c) => `CAST(${wgsB4gIdent(c)} AS CHAR) = ?`)
      .join("OR ");

    const params = searchable.map(() => String(rawUserId).trim());

    const [rows] = await pool.query(
      `SELECT ${searchable.map(wgsB4gIdent).join(", ")} FROM \`users\` WHERE ${where} LIMIT 10`,
      params
    );

    for (const row of rows) {
      for (const c of searchable) {
        add(row[c]);
      }
    }
  } catch (err) {
    console.warn("[WGS B4G] user candidate expand failed:", err.message);
  }

  return Array.from(set);
}

async function wgsB4gQueryWrittenRankingTable({ tableName, type, userCandidates, startDate, endDate }) {
  if (!userCandidates.length) return [];
  if (!(await wgsB4gTableExists(tableName))) return [];

  const [cols] = await pool.query(`SHOW COLUMNS FROM ${wgsB4gIdent(tableName)}`);
  const fields = cols.map((c) => c.Field);

  const userCol = wgsB4gPickColumn(fields, [
    "userId",
    "user_id",
    "userid",
    "memberId",
    "member_id",
    "loginId",
    "login_id",
    "username",
    "name",
    "nickname"
  ]);

  const dateCol = wgsB4gPickColumn(fields, [
    "date",
    "ranking_date",
    "rankingDate",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt"
  ]);

  const solvedCol = wgsB4gPickColumn(fields, [
    "solved_count",
    "solvedCount",
    "total_count",
    "totalCount",
    "question_count",
    "questionCount"
  ]);

  const correctCol = wgsB4gPickColumn(fields, [
    "correct_count",
    "correctCount",
    "right_count",
    "rightCount"
  ]);

  const scoreCol = wgsB4gPickColumn(fields, [
    "score",
    "total_score",
    "totalScore",
    "point",
    "points"
  ]);

  if (!userCol || !dateCol) {
    console.warn("[WGS B4G] ranking table column missing:", tableName, { userCol, dateCol, fields });
    return [];
  }

  const dateExpr = `DATE(${wgsB4gIdent(dateCol)})`;

  let scoreExpr = "0";
  if (scoreCol) {
    scoreExpr = `SUM(CAST(${wgsB4gIdent(scoreCol)} AS SIGNED))`;
  } else if (correctCol) {
    // 필기 문제은행은 현재 화면의 205점처럼 정답수 * 5점 기준으로 맞춘다.
    scoreExpr =
      type === "random"? `SUM(CAST(${wgsB4gIdent(correctCol)} AS SIGNED) * 5)`
        : `SUM(CAST(${wgsB4gIdent(correctCol)} AS SIGNED))`;
  }

  const solvedExpr = solvedCol
    ? `SUM(CAST(${wgsB4gIdent(solvedCol)} AS SIGNED))`
    : "0";

  const correctExpr = correctCol
    ? `SUM(CAST(${wgsB4gIdent(correctCol)} AS SIGNED))`
    : "0";

  const sql = `SELECT
      ${dateExpr} AS date,
      ${scoreExpr} AS score,
      ${correctExpr} AS correctCount,
      ${solvedExpr} AS solvedCount
    FROM ${wgsB4gIdent(tableName)}
    WHERE ${dateExpr} BETWEEN ? AND ?
      AND CAST(${wgsB4gIdent(userCol)} AS CHAR) IN (?)
    GROUP BY ${dateExpr}
    ORDER BY ${dateExpr} ASC
  `;

  const [rows] = await pool.query(sql, [startDate, endDate, userCandidates]);

  return rows.map((r) => {
    const solved = wgsB4gNum(r.solvedCount);
    const correct = wgsB4gNum(r.correctCount);
    return {
      date: wgsB4gDateOnly(r.date),
      score: wgsB4gNum(r.score),
      correctCount: correct,
      solvedCount: solved,
      accuracy: solved >0 ? Math.round((correct / solved) * 1000) / 10 : 0,
      source: tableName
    };
  });
}

function wgsB4gReadJsonFileSafe(filePath) {
  try {
    const fs = require("fs");
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn("[WGS B4G] JSON read failed:", filePath, err.message);
    return null;
  }
}

function wgsB4gFlattenRankingJson(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const key of ["rankings", "records", "data", "items", "list", "history"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [];
}

async function wgsB4gQueryJsonRankings({ type, userCandidates, startDate, endDate }) {
  const path = require("path");

  const possibleFiles = [
    typeof RANKING_DATA_FILE !== "undefined"? RANKING_DATA_FILE : null,
    typeof IPEP_RANKING_FILE !== "undefined"? IPEP_RANKING_FILE : null,
    path.join(__dirname, "ranking_data.json"),
    path.join(__dirname, "ipep_ranking.json"),
    path.join(__dirname, "ipep_rankings.json"),
    path.join(__dirname, "data", "ranking_data.json"),
    path.join(__dirname, "data", "ipep_ranking.json"),
    path.join(__dirname, "data", "ipep_rankings.json")
  ].filter(Boolean);

  const candidateSet = new Set(userCandidates.map((v) => String(v)));

  const map = new Map();

  for (const file of possibleFiles) {
    const json = wgsB4gReadJsonFileSafe(file);
    const arr = wgsB4gFlattenRankingJson(json);

    for (const item of arr) {
      if (!item || typeof item !== "object") continue;

      const itemType = String(item.type || item.mode || item.examType || item.category || "").toLowerCase();
      if (type.includes("ipep") && itemType && !itemType.includes("ipep") && !itemType.includes("실기")) {
        continue;
      }

      const userValue = String(
        item.userId ??
        item.user_id ??
        item.userid ??
        item.loginId ??
        item.name ??
        item.nickname ??
        ""
      ).trim();

      if (candidateSet.size && userValue && !candidateSet.has(userValue)) continue;

      const date = wgsB4gDateOnly(item.date || item.created_at || item.createdAt || item.rankingDate);
      if (!date || date < startDate || date >endDate) continue;

      const score = wgsB4gNum(item.score ?? item.totalScore ?? item.point ?? item.points);
      const correct = wgsB4gNum(item.correctCount ?? item.correct_count ?? item.correct);
      const solved = wgsB4gNum(item.solvedCount ?? item.solved_count ?? item.totalCount ?? item.total_count);

      const prev = map.get(date) || {
        date,
        score: 0,
        correctCount: 0,
        solvedCount: 0,
        source: "json"
      };

      prev.score += score;
      prev.correctCount += correct;
      prev.solvedCount += solved;
      map.set(date, prev);
    }
  }

  return Array.from(map.values()).map((r) => ({
    ...r,
    accuracy: r.solvedCount >0 ? Math.round((r.correctCount / r.solvedCount) * 1000) / 10 : 0
  }));
}

function wgsB4gMergeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const date = wgsB4gDateOnly(row.date);
    if (!date) continue;

    const prev = map.get(date) || {
      date,
      score: 0,
      correctCount: 0,
      solvedCount: 0,
      source: row.source || ""
    };

    prev.score += wgsB4gNum(row.score);
    prev.correctCount += wgsB4gNum(row.correctCount);
    prev.solvedCount += wgsB4gNum(row.solvedCount);
    prev.source = prev.source || row.source || "";

    map.set(date, prev);
  }

  return Array.from(map.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => ({
      ...r,
      accuracy: r.solvedCount >0 ? Math.round((r.correctCount / r.solvedCount) * 1000) / 10 : 0
    }));
}

async function wgsB4gMyRankingHistoryHandler(req, res) {
  try {
    const type = wgsB4gNormalizeType(req.query.type);

    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().slice(0, 10);

    const startDate = String(req.query.startDate || req.query.from || today).slice(0, 10);
    const endDate = String(req.query.endDate || req.query.to || today).slice(0, 10);

    const rawUserId = String(
      req.query.userId ||
      req.query.userid ||
      req.query.user_id ||
      req.session?.user?.userId ||
      req.session?.user?.id ||
      req.session?.user?.name ||
      req.user?.userId ||
      req.user?.id ||
      ""
    ).trim();

    if (!rawUserId) {
      return res.json({
        ok: true,
        success: true,
        type,
        rows: [],
        data: [],
        summary: {
          totalScore: 0,
          maxScore: 0,
          avgAccuracy: 0,
          recordDays: 0
        },
        message: "로그인 사용자 정보가 없어 개인 랭킹 히스토리를 조회하지 않았습니다."
      });
    }

    const userCandidates = await wgsB4gGetUserCandidates(rawUserId);

    let rows = [];

    if (type === "random") {
      rows = rows.concat(
        await wgsB4gQueryWrittenRankingTable({
          tableName: "wgs_ranking_random",
          type,
          userCandidates,
          startDate,
          endDate
        })
      );
    } else if (type === "past") {
      rows = rows.concat(
        await wgsB4gQueryWrittenRankingTable({
          tableName: "wgs_ranking_past",
          type,
          userCandidates,
          startDate,
          endDate
        })
      );
    } else {
      rows = rows.concat(
        await wgsB4gQueryJsonRankings({
          type,
          userCandidates,
          startDate,
          endDate
        })
      );
    }

    rows = wgsB4gMergeRows(rows);

    const totalScore = rows.reduce((sum, r) => sum + wgsB4gNum(r.score), 0);
    const maxScore = rows.reduce((max, r) => Math.max(max, wgsB4gNum(r.score)), 0);
    const avgAccuracy =
      rows.length >0
        ? Math.round((rows.reduce((sum, r) => sum + wgsB4gNum(r.accuracy), 0) / rows.length) * 10) / 10
        : 0;

    return res.json({
      ok: true,
      success: true,
      type,
      startDate,
      endDate,
      rows,
      data: rows,
      summary: {
        totalScore,
        maxScore,
        avgAccuracy,
        recordDays: rows.length
      }
    });
  } catch (err) {
    console.error("[WGS B4G] /api/my-ranking-history error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "개인 랭킹 히스토리 조회 중 오류가 발생했습니다.",
      error: err.message
    });
  }
}

app.get('/api/my-ranking-history-v2', wgsB4gMyRankingHistoryHandler);
app.get('/api/my-ranking-history', wgsB4gMyRankingHistoryHandler);
// 개인 랭킹 히스토리 DB 실연동 우선 라우트 끝


app.get('/api/my-ranking-history', wgsB4cMyRankingHistoryHandler);
app.get('/api/my-ranking-history-v2', wgsB4cMyRankingHistoryHandler);


app.get('/api/my-ranking-history', async (req, res) => {
    try {
        const allowedTypes = ['random', 'past', 'ipep_random', 'ipep_past'];

        const type = String(req.query.type || 'random').trim();
        const userId = String(req.query.userId || req.query.id || '').trim();

        if (!allowedTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                msg: '지원하지 않는 랭킹 유형입니다.',
                allowedTypes
            });
        }
        if (!userId) {
            return res.status(400).json({
                success: false,
                msg: '사용자 ID가 올바르지 않습니다.'
            });
        }

        const todayInfo = typeof getSeasonStatus === 'function'? getSeasonStatus()
            : { rankingDate: new Date().toISOString().slice(0, 10) };

        const isDateText = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

        const startDate = isDateText(req.query.startDate)
            ? String(req.query.startDate)
            : String(todayInfo.rankingDate);

        const endDate = isDateText(req.query.endDate)
            ? String(req.query.endDate)
            : startDate;

        const fromDate = startDate <= endDate ? startDate : endDate;
        const toDate = startDate <= endDate ? endDate : startDate;

        const year = req.query.year && req.query.year !== 'all'? Number(req.query.year)
            : null;

        const session = req.query.session && req.query.session !== 'all'? Number(req.query.session)
            : null;

        const toNumber = (value, fallback = 0) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };

        const toAccuracy = (correct, total) => {
            const c = toNumber(correct);
            const t = toNumber(total);
            if (t <= 0) return 0;
            return Math.round((c / t) * 1000) / 10;
        };

        const makeSummary = (rows) => {
            const totalScore = rows.reduce((sum, row) => sum + toNumber(row.score), 0);
            const totalCorrect = rows.reduce((sum, row) => sum + toNumber(row.correctCount), 0);
            const totalSolved = rows.reduce((sum, row) => sum + toNumber(row.totalCount), 0);

            return {
                totalDays: rows.length,
                totalScore,
                totalCorrect,
                totalSolved,
                averageAccuracy: toAccuracy(totalCorrect, totalSolved)
            };
        };

        let rows = [];

        if (type === 'random') {
            const [result] = await pool.query(
                `SELECT
                    r.date AS date,
                    SUM(r.solved_count) AS totalCount,
                    SUM(r.correct_count) AS correctCount
                FROM wgs_ranking_random r
                WHERE r.userId = ?
                  AND r.date BETWEEN ? AND ?
                GROUP BY r.date
                ORDER BY r.date ASC
                `,
                [userId, fromDate, toDate]
            );

            rows = result.map((row) => {
                const totalCount = toNumber(row.totalCount);
                const correctCount = toNumber(row.correctCount);
                return {
                    type,
                    label: '필기 문제은행',
                    date: row.date,
                    year: null,
                    session: null,
                    totalCount,
                    correctCount,
                    score: correctCount * 5,
                    accuracy: toAccuracy(correctCount, totalCount)
                };
            });
        }

        if (type === 'past') {
            const where = [
                'r.userId = ?',
                'r.date BETWEEN ? AND ?'
            ];
            const params = [userId, fromDate, toDate];

            if (Number.isInteger(year)) {
                where.push('r.year = ?');
                params.push(year);
            }

            if (Number.isInteger(session)) {
                where.push('r.session = ?');
                params.push(session);
            }

            const [result] = await pool.query(
                `SELECT
                    r.date AS date,
                    r.year AS year,
                    r.session AS session,
                    SUM(r.solved_count) AS totalCount,
                    SUM(r.correct_count) AS correctCount
                FROM wgs_ranking_past r
                WHERE ${where.join(' AND ')}
                GROUP BY r.date, r.year, r.session
                ORDER BY r.date ASC, r.year DESC, r.session ASC
                `,
                params
            );

            rows = result.map((row) => {
                const totalCount = toNumber(row.totalCount);
                const correctCount = toNumber(row.correctCount);
                return {
                    type,
                    label: '필기 기출문제',
                    date: row.date,
                    year: row.year,
                    session: row.session,
                    totalCount,
                    correctCount,
                    score: correctCount,
                    accuracy: toAccuracy(correctCount, totalCount)
                };
            });
        }

        if (type === 'ipep_random' || type === 'ipep_past') {
            let sourceList = [];

            try {
                if (typeof fs !== 'undefined' && typeof IPEP_RANKING_FILE !== 'undefined' && fs.existsSync(IPEP_RANKING_FILE)) {
                    const raw = fs.readFileSync(IPEP_RANKING_FILE, 'utf-8');
                    const parsed = JSON.parse(raw || '[]');
                    sourceList = Array.isArray(parsed) ? parsed : [];
                }
            } catch (fileErr) {
                console.warn('[my-ranking-history] 실기 랭킹 JSON 읽기 경고:', fileErr.message);
                sourceList = [];
            }

            const grouped = new Map();

            for (const row of sourceList) {
                const rowUserId = toNumber(row.userId ?? row.id ?? row.user_id);
                if (rowUserId !== userId) continue;

                const rowDate = String(row.rankingDate || row.date || '').slice(0, 10);
                if (!isDateText(rowDate)) continue;
                if (rowDate < fromDate || rowDate >toDate) continue;

                const rawMode = String(row.mode || row.type || row.source || '').toLowerCase();
                const isPastMode = rawMode.includes('past');

                if (type === 'ipep_past' && !isPastMode) continue;
                if (type === 'ipep_random' && isPastMode) continue;

                const rowYear = row.year == null || row.year === ''? null : Number(row.year);
                const rowSession = row.session == null || row.session === ''? null : Number(row.session);

                if (Number.isInteger(year) && rowYear !== year) continue;
                if (Number.isInteger(session) && rowSession !== session) continue;

                const key = [
                    rowDate,
                    Number.isInteger(rowYear) ? rowYear : 'all',
                    Number.isInteger(rowSession) ? rowSession : 'all'
                ].join('|');

                if (!grouped.has(key)) {
                    grouped.set(key, {
                        type,
                        label: type === 'ipep_past'? '실기 기출문제' : '실기 문제은행',
                        date: rowDate,
                        year: Number.isInteger(rowYear) ? rowYear : null,
                        session: Number.isInteger(rowSession) ? rowSession : null,
                        totalCount: 0,
                        correctCount: 0,
                        score: 0
                    });
                }

                const item = grouped.get(key);

                const attemptedCount = toNumber(row.attemptedCount ?? row.totalCount ?? row.solvedCount ?? 0);
                const correctCount = toNumber(row.correctCount ?? row.correct ?? 0);
                const score = toNumber(row.totalScore ?? row.score ?? row.points ?? 0);

                item.totalCount += attemptedCount;
                item.correctCount += correctCount;
                item.score += score;
            }

            rows = Array.from(grouped.values())
                .map((row) => ({
                    ...row,
                    accuracy: toAccuracy(row.correctCount, row.totalCount)
                }))
                .sort((a, b) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date);
                    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
                    return (a.session || 0) - (b.session || 0);
                });
        }

        const series = {
            labels: rows.map((row) => {
                if (row.year && row.session) return `${row.date} ${row.year}-${row.session}`;
                return row.date;
            }),
            scores: rows.map((row) => row.score),
            accuracies: rows.map((row) => row.accuracy)
        };

        return res.json({
            success: true,
            type,
            userId,
            startDate: fromDate,
            endDate: toDate,
            year,
            session,
            rows,
            series,
            summary: makeSummary(rows)
        });
    } catch (err) {
        console.error('/api/my-ranking-history error:', err);
        return res.status(500).json({
            success: false,
            msg: '개인 랭킹 히스토리 조회 중 오류가 발생했습니다.',
            error: err.message
        });
    }
});

}

module.exports = registerRankingHistoryRoutes;
