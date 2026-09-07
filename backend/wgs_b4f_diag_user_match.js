const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (e) {
  console.log("[WARN] dotenv 로드 실패:", e.message);
}

const mysql = require("mysql2/promise");

function envPick(...keys) {
  for (const k of keys) {
    if (process.env[k] !== undefined && process.env[k] !== "") return process.env[k];
  }
  return undefined;
}

async function main() {
  const config = {
    host: envPick("DB_HOST", "MYSQL_HOST") || "localhost",
    port: Number(envPick("DB_PORT", "MYSQL_PORT") || 3306),
    user: envPick("DB_USER", "MYSQL_USER") || "root",
    password: envPick("DB_PASSWORD", "MYSQL_PASSWORD", "DB_PASS", "MYSQL_PASS") || "",
    database: envPick("DB_NAME", "DB_DATABASE", "MYSQL_DATABASE", "DATABASE") || "exam_bank",
    multipleStatements: false,
  };

  console.log("[DB CONFIG]", {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password ? "***MASKED***" : "(empty)",
  });

  const conn = await mysql.createConnection(config);

  const [dbRows] = await conn.query("SELECT DATABASE() AS db");
  console.log("[CURRENT DB]", dbRows);

  const [tables] = await conn.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND (
        table_name LIKE '%rank%'
        OR table_name LIKE '%score%'
        OR table_name LIKE '%result%'
        OR table_name LIKE '%wrong%'
        OR table_name LIKE '%exam%'
        OR table_name LIKE '%user%'
      )
    ORDER BY table_name
  `);

  console.log("");
  console.log("[CANDIDATE TABLES]");
  console.table(tables);

  for (const row of tables) {
    const table = row.TABLE_NAME || row.table_name;
    console.log("");
    console.log("---- TABLE:", table, "----");

    try {
      const [cols] = await conn.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
        ORDER BY ordinal_position
      `, [table]);
      console.table(cols);

      const userLikeCols = cols
        .map(c => c.COLUMN_NAME || c.column_name)
        .filter(c => /user|id|name|nick|score|correct|total|date|created|type|year|round/i.test(c));

      if (userLikeCols.length > 0) {
        const selectCols = userLikeCols.map(c => `\`${c}\``).join(", ");
        const orderCol = userLikeCols.find(c => /created|date|time|id/i.test(c)) || userLikeCols[0];

        const [sample] = await conn.query(
          `SELECT ${selectCols} FROM \`${table}\` ORDER BY \`${orderCol}\` DESC LIMIT 10`
        );

        console.log("[최근 샘플]");
        console.table(sample);
      }
    } catch (e) {
      console.log("[WARN] table inspect failed:", table, e.message);
    }
  }

  console.log("");
  console.log("==============================");
  console.log("[5] 자주 보이는 사용자 키 후보별 데이터 카운트");
  console.log("==============================");

  const candidateUsers = [
    "jiyong1537",
    "choiwon10",
    "skn29",
    "admin",
    "관리자",
    "최지용",
    "지용",
  ];

  for (const row of tables) {
    const table = row.TABLE_NAME || row.table_name;

    const [cols] = await conn.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `, [table]);

    const colNames = cols.map(c => c.COLUMN_NAME || c.column_name);
    const idCols = colNames.filter(c => /user|member|login|account|name|nick|id/i.test(c));

    if (idCols.length === 0) continue;

    console.log("");
    console.log("---- USER MATCH TABLE:", table, "----");

    for (const col of idCols) {
      for (const u of candidateUsers) {
        try {
          const [cnt] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE \`${col}\` = ?`,
            [u]
          );
          if (cnt[0].cnt > 0) {
            console.log(`[MATCH] ${table}.${col} = ${u} => ${cnt[0].cnt}`);
          }
        } catch (e) {
          // 타입 불일치 등은 무시
        }
      }
    }
  }

  await conn.end();
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});
