// 사용자별 랭킹 이력 API를 제공합니다.
'use strict';

const path = require('path');
const { createLegacyRankingHistoryHandler } = require('./legacyRankingHistoryHandler');

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
    const wgsB4cMyRankingHistoryHandler = createLegacyRankingHistoryHandler({ pool });


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
