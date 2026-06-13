// 기존 문제 행을 교체하지 않고 해설 데이터를 가져옵니다.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // CRLF의 CR은 무시
    } else {
      field += ch;
    }
  }

  if (field.length >0 || row.length >0) {
    row.push(field);
    if (row.some(v => String(v).trim() !== '')) rows.push(row);
  }

  return rows;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  const csvPath = process.argv[2] || '/home/ubuntu/2021_2025_explain.csv';
  const apply = process.argv.includes('--apply');
  const onlyExplanationText = process.argv.includes('--only-explanation-text');

  if (apply && !onlyExplanationText) {
    throw new Error('실제 반영은 --apply --only-explanation-text 옵션을 함께 넣어야 합니다.');
  }

  loadEnv(path.join(__dirname, '..', '.env'));

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);

  if (rows.length < 2) throw new Error('CSV 데이터가 비어 있습니다.');

  const header = rows.shift().map((v, idx) => {
    const cleaned = idx === 0 ? String(v).replace(/^\uFEFF/, '') : String(v);
    return cleaned.trim();
  });

  const questionIdIdx = header.indexOf('question_id');
  const explanationTextIdx = header.indexOf('explanation_text');

  if (questionIdIdx === -1) throw new Error('CSV에 question_id 컬럼이 없습니다.');
  if (explanationTextIdx === -1) throw new Error('CSV에 explanation_text 컬럼이 없습니다.');

  const records = [];
  const seen = new Set();

  for (const row of rows) {
    const questionId = Number(String(row[questionIdIdx] || '').trim());
    const explanationText = String(row[explanationTextIdx] ?? '').trim();

    if (!Number.isInteger(questionId) || questionId < 1 || questionId >1500) {
      throw new Error(`잘못된 question_id 발견: ${row[questionIdIdx]}`);
    }

    if (seen.has(questionId)) {
      throw new Error(`중복 question_id 발견: ${questionId}`);
    }

    if (!explanationText) {
      throw new Error(`explanation_text가 비어 있음: question_id=${questionId}`);
    }

    seen.add(questionId);
    records.push({ questionId, explanationText });
  }

  if (records.length !== 1500) {
    throw new Error(`CSV 행 수가 1500개가 아닙니다. 현재: ${records.length}`);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'exam_bank',
    charset: 'utf8mb4'
  });

  try {
    const [colRows] = await conn.query(`SELECT COLUMN_NAME AS column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'answers' AND column_name IN ('question_id', 'correct_label', 'explanation_text', 'explanation_img')
      ORDER BY column_name
    `);

    const colNames = colRows.map(r => r.column_name);
    if (!colNames.includes('question_id') || !colNames.includes('explanation_text')) {
      throw new Error('answers 테이블에 question_id 또는 explanation_text 컬럼이 없습니다.');
    }

    await conn.query(`DROP TEMPORARY TABLE IF EXISTS tmp_explain_ids`);
    await conn.query(`CREATE TEMPORARY TABLE tmp_explain_ids (question_id INT PRIMARY KEY)`);

    for (const chunk of chunkArray(records.map(r => r.questionId), 500)) {
      const placeholders = chunk.map(() => '(?)').join(',');
      await conn.query(`INSERT INTO tmp_explain_ids (question_id) VALUES ${placeholders}`, chunk);
    }

    const [[matchRow]] = await conn.query(`SELECT COUNT(*) AS matched_count
      FROM answers a
      JOIN tmp_explain_ids t ON a.question_id = t.question_id
    `);

    const matchedCount = Number(matchRow.matched_count || 0);

    const [missingRows] = await conn.query(`SELECT t.question_id
      FROM tmp_explain_ids t
      LEFT JOIN answers a ON a.question_id = t.question_id
      WHERE a.question_id IS NULL
      ORDER BY t.question_id
      LIMIT 20
    `);

    console.log('====================================');
    console.log('CSV 행 수:', records.length);
    console.log('answers 매칭 수:', matchedCount);
    console.log('누락 question_id:', missingRows.map(r => r.question_id).join(', ') || '없음');
    console.log('실행 모드:', apply ? '실제 UPDATE 실행' : '검증만 실행');
    console.log('업데이트 대상 컬럼: answers.explanation_text ONLY');
    console.log('무시하는 CSV 컬럼: correct_label, explanation_img');
    console.log('====================================');

    console.log('샘플 5개:');
    for (const sample of records.filter(r => [1, 100, 101, 500, 1500].includes(r.questionId))) {
      console.log(`${sample.questionId}: ${sample.explanationText.slice(0, 90)}`);
    }

    if (matchedCount !== 1500 || missingRows.length >0) {
      throw new Error('answers 테이블과 CSV question_id 매칭이 1500개가 아닙니다. 업데이트 중단.');
    }

    if (!apply) {
      console.log('검증만 완료했습니다. DB는 수정하지 않았습니다.');
      return;
    }

    const [[beforeGuard]] = await conn.query(`SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(CRC32(CONCAT_WS('|', question_id, COALESCE(correct_label, ''), COALESCE(explanation_img, '')))), 0) AS guard_checksum
      FROM answers
      WHERE question_id BETWEEN 1 AND 1500
    `);

    await conn.beginTransaction();

    let updated = 0;
    for (const item of records) {
      await conn.execute(
        `UPDATE answers SET explanation_text = ? WHERE question_id = ?`,
        [item.explanationText, item.questionId]
      );
      updated++;
    }

    const [[afterGuard]] = await conn.query(`SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(CRC32(CONCAT_WS('|', question_id, COALESCE(correct_label, ''), COALESCE(explanation_img, '')))), 0) AS guard_checksum
      FROM answers
      WHERE question_id BETWEEN 1 AND 1500
    `);

    if (String(beforeGuard.guard_checksum) !== String(afterGuard.guard_checksum)) {
      throw new Error('correct_label 또는 explanation_img 변경 감지. 롤백합니다.');
    }

    await conn.commit();

    const [[finalRow]] = await conn.query(`SELECT COUNT(*) AS filled_count
      FROM answers
      WHERE question_id BETWEEN 1 AND 1500
        AND explanation_text IS NOT NULL
        AND TRIM(explanation_text) <> ''
    `);

    console.log('====================================');
    console.log('UPDATE 완료');
    console.log('업데이트 시도 행 수:', updated);
    console.log('해설 채워진 행 수:', finalRow.filled_count);
    console.log('보호 체크 통과: correct_label, explanation_img 변경 없음');
    console.log('====================================');
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});
