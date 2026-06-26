const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { loadEnvFile } = require('../../config/env');
const { createDatabasePool } = require('../../config/database');

loadEnvFile();

const BACKEND_DIR = path.resolve(__dirname, '../..');
const PROJECT_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const CSV_PATH = path.join(PROJECT_ROOT, 'ThreeWeek_Study', 'three_week_questions.csv');

const WEEK_SECTIONS = {
    1: ['007', '010', '011', '018', '023', '030', '034', '035', '036', '037', '038', '040', '041', '048', '052', '054', '055', '060', '063', '065'],
    2: ['067', '068', '071', '079', '080', '083', '084', '086', '093', '094', '095', '101', '102', '104', '105', '106', '107', '114', '115', '116'],
    3: ['117', '118', '119', '120', '121', '122', '123', '124', '125', '126', '127', '132', '136', '138', '139', '140', '142', '143', '145', '158'],
};

function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeFlexible(value) {
    let text = cleanText(value);
    text = text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.normalize('NFKC').toLowerCase();
    text = text.replace(/["'`]/g, '');
    text = text.replace(/[.,:;!?~\-_/\\()[\]{}<>|]/g, '');
    text = text.replace(/\s+/g, '');
    return text.trim();
}

const ORDERED_LABEL_PATTERN = /^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|(?:\(?\d{1,2}\)?(?:[.)、:：]|\s+)))\s*/u;

function stripLeadingOrderLabel(value) {
    const text = cleanText(value);
    if (!text) return '';

    const rawStripped = text.replace(ORDERED_LABEL_PATTERN, '').trim();
    if (rawStripped !== text) {
        return rawStripped;
    }

    return text.normalize('NFKC').replace(ORDERED_LABEL_PATTERN, '').trim();
}

function normalizeSymbolicFlexible(value) {
    let text = cleanText(value);
    text = text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.normalize('NFKC').toLowerCase();
    text = text.replace(/[“”‘’"'`]/g, '');
    text = text.replace(/[.,。·!?:;，、|]/g, '');
    text = text.replace(/\s+/g, '');
    return text.trim();
}

function uniqueNonEmpty(items) {
    return [...new Set(items.map(cleanText).filter(Boolean))];
}

function buildComparableVariants(value) {
    const raw = cleanText(value);
    const withoutOrderLabel = stripLeadingOrderLabel(raw);
    const candidates = uniqueNonEmpty([raw, withoutOrderLabel]);
    const variants = [];

    for (const candidate of candidates) {
        variants.push(normalizeFlexible(candidate));
        variants.push(normalizeSymbolicFlexible(candidate));
    }

    return uniqueNonEmpty(variants);
}

function shouldSplitByComma(answerRaw) {
    const raw = cleanText(answerRaw);
    const upper = raw.toUpperCase();
    if (!raw.includes(',')) return false;
    if (raw.includes('\\n') || raw.includes('\n')) return false;
    return !(
        upper.includes('SELECT ') ||
        upper.includes('INSERT ') ||
        upper.includes('UPDATE ') ||
        upper.includes('DELETE ') ||
        upper.includes('CREATE ') ||
        upper.includes(' FROM ') ||
        upper.includes(' WHERE ')
    );
}

function buildAnswerAliases(answerRaw) {
    const raw = cleanText(answerRaw);
    if (!raw) return [];
    return uniqueNonEmpty(raw.split('|').flatMap(buildComparableVariants));
}

function buildAnswerSlots(answerRaw) {
    const raw = cleanText(answerRaw);
    if (!raw) return [];
    if (!shouldSplitByComma(raw)) {
        const aliases = buildAnswerAliases(raw);
        return [aliases.length > 0 ? aliases : [normalizeFlexible(raw)]];
    }
    return raw
        .split(',')
        .map((part) => uniqueNonEmpty(part.split('|').flatMap(buildComparableVariants)))
        .filter((slot) => slot.length > 0);
}

function inferGradingPolicy(questionText, answerRaw) {
    const question = cleanText(questionText);
    const raw = cleanText(answerRaw);
    const upper = raw.toUpperCase();

    if (!raw) return 'EMPTY';
    if (raw.includes('\\n') || raw.includes('\n')) return 'EXACT_OUTPUT';
    if (
        upper.includes('SELECT ') ||
        upper.includes('INSERT ') ||
        upper.includes('UPDATE ') ||
        upper.includes('DELETE ') ||
        upper.includes('CREATE ') ||
        upper.includes(' FROM ') ||
        upper.includes(' WHERE ')
    ) {
        return 'SQL_TEXT';
    }
    if (question.includes('출력') || question.includes('실행 결과') || question.includes('실행결과')) {
        return 'EXACT_OUTPUT';
    }
    if (shouldSplitByComma(raw)) return 'MULTI_TERM';
    if (raw.length >= 45 && /[가-힣]/.test(raw)) return 'SELF_CHECK';
    return 'FLEX_TERM';
}

function parseQuestionKey(value) {
    const key = cleanText(value);
    const match = key.match(/^(\d{3})-(\d+)$/);
    return {
        key,
        sectionNo: match ? match[1] : cleanText(key.split('-')[0]).padStart(3, '0'),
        questionNo: match ? Number(match[2]) : 0,
    };
}

function getWeekNo(sectionNo) {
    const normalized = cleanText(sectionNo).padStart(3, '0');
    for (const [weekNo, sections] of Object.entries(WEEK_SECTIONS)) {
        if (sections.includes(normalized)) return Number(weekNo);
    }
    return 1;
}

function splitChoiceValue(rawValue) {
    const value = cleanText(rawValue);
    if (!value) return { choiceText: '', choiceImgPath: null };
    if (/^\/ipep-img\/three-week\//i.test(value) || /\.(png|jpe?g|webp)$/i.test(value)) {
        return { choiceText: '', choiceImgPath: value };
    }
    return { choiceText: value, choiceImgPath: null };
}

function readCsvRows() {
    if (!fs.existsSync(CSV_PATH)) {
        throw new Error(`CSV file not found: ${CSV_PATH}`);
    }
    const content = fs.readFileSync(CSV_PATH, 'utf8');
    const records = parse(content, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });
    const [headers = [], ...rows] = records;
    return rows.map((record) => {
        const normalized = record.length > headers.length
            ? [...record.slice(0, headers.length - 1), record.slice(headers.length - 1).join(',')]
            : [...record];
        while (normalized.length < headers.length) normalized.push('');
        return Object.fromEntries(headers.map((header, index) => [header, normalized[index] || '']));
    });
}

async function createTables(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_three_week_sections (
        section_no CHAR(3) NOT NULL,
        week_no TINYINT NOT NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (section_no),
        KEY idx_ipep_three_week_sections_week (week_no, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_three_week_questions (
        question_id INT NOT NULL AUTO_INCREMENT,
        section_no CHAR(3) NOT NULL,
        section_question_key VARCHAR(20) NOT NULL,
        question_no SMALLINT NOT NULL DEFAULT 0,
        question_order INT NOT NULL DEFAULT 0,
        question_text TEXT NOT NULL,
        answer_raw TEXT,
        answer_normalized TEXT,
        answer_aliases_json JSON,
        answer_slots_json JSON,
        grading_policy VARCHAR(30) NOT NULL DEFAULT 'FLEX_TERM',
        score INT NOT NULL DEFAULT 5,
        choice_text TEXT,
        choice_img_path VARCHAR(255) DEFAULT NULL,
        explanation_text TEXT,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (question_id),
        UNIQUE KEY uq_ipep_three_week_question_key (section_question_key),
        KEY idx_ipep_three_week_section (section_no, question_no),
        KEY idx_ipep_three_week_order (question_order),
        CONSTRAINT fk_ipep_three_week_question_section
            FOREIGN KEY (section_no)
            REFERENCES ipep_three_week_sections(section_no)
            ON UPDATE CASCADE
            ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function upsertSections(pool) {
    let displayOrder = 1;
    for (const [weekNo, sections] of Object.entries(WEEK_SECTIONS)) {
        for (const sectionNo of sections) {
            await pool.query(
                `INSERT INTO ipep_three_week_sections (section_no, week_no, display_order, is_active)
                 VALUES (?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    week_no = VALUES(week_no),
                    display_order = VALUES(display_order),
                    is_active = VALUES(is_active)`,
                [sectionNo, Number(weekNo), displayOrder]
            );
            displayOrder += 1;
        }
    }
}

async function importQuestions(pool) {
    const rows = readCsvRows();
    const warnings = [];
    let savedRows = 0;

    for (const [index, row] of rows.entries()) {
        const parsed = parseQuestionKey(row['section번호-문제']);
        const sectionNo = cleanText(row['section번호'] || parsed.sectionNo).padStart(3, '0');
        const questionKey = parsed.key || `${sectionNo}-${parsed.questionNo || index + 1}`;
        const questionNo = parsed.questionNo || Number(questionKey.split('-')[1] || 0);
        const questionText = cleanText(row['문제 질의']);
        const answerRaw = cleanText(row['문제 정답']);
        const { choiceText, choiceImgPath } = splitChoiceValue(row['문제 보기']);
        const explanationText = cleanText(row['문제 해설']);

        if (!questionText) warnings.push(`question text empty: ${questionKey}`);
        if (!answerRaw) warnings.push(`answer empty: ${questionKey}`);

        await pool.query(
            `INSERT INTO ipep_three_week_questions (
                section_no,
                section_question_key,
                question_no,
                question_order,
                question_text,
                answer_raw,
                answer_normalized,
                answer_aliases_json,
                answer_slots_json,
                grading_policy,
                score,
                choice_text,
                choice_img_path,
                explanation_text,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 5, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                section_no = VALUES(section_no),
                question_no = VALUES(question_no),
                question_order = VALUES(question_order),
                question_text = VALUES(question_text),
                answer_raw = VALUES(answer_raw),
                answer_normalized = VALUES(answer_normalized),
                answer_aliases_json = VALUES(answer_aliases_json),
                answer_slots_json = VALUES(answer_slots_json),
                grading_policy = VALUES(grading_policy),
                score = VALUES(score),
                choice_text = VALUES(choice_text),
                choice_img_path = VALUES(choice_img_path),
                explanation_text = VALUES(explanation_text),
                is_active = VALUES(is_active)`,
            [
                sectionNo,
                questionKey,
                questionNo,
                index + 1,
                questionText,
                answerRaw,
                normalizeFlexible(answerRaw),
                JSON.stringify(buildAnswerAliases(answerRaw)),
                JSON.stringify(buildAnswerSlots(answerRaw)),
                inferGradingPolicy(questionText, answerRaw),
                choiceText || null,
                choiceImgPath,
                explanationText || null,
            ]
        );
        savedRows += 1;
    }

    return { totalRows: rows.length, savedRows, warnings };
}

async function printSummary(pool) {
    const [[questionCount]] = await pool.query(`SELECT COUNT(*) AS count FROM ipep_three_week_questions WHERE is_active = 1`);
    const [byWeek] = await pool.query(`SELECT
            s.week_no AS weekNo,
            COUNT(q.question_id) AS questionCount
        FROM ipep_three_week_sections s
        LEFT JOIN ipep_three_week_questions q
            ON q.section_no = s.section_no
            AND q.is_active = 1
        GROUP BY s.week_no
        ORDER BY s.week_no ASC`);
    const [bySection] = await pool.query(`SELECT
            s.week_no AS weekNo,
            s.section_no AS sectionNo,
            COUNT(q.question_id) AS questionCount
        FROM ipep_three_week_sections s
        LEFT JOIN ipep_three_week_questions q
            ON q.section_no = s.section_no
            AND q.is_active = 1
        GROUP BY s.week_no, s.section_no, s.display_order
        ORDER BY s.display_order ASC`);

    console.log('[three-week] active questions:', questionCount.count);
    console.table(byWeek);
    console.table(bySection.filter((row) => Number(row.questionCount) > 0));
}

async function main() {
    const pool = createDatabasePool();
    try {
        await pool.query('SELECT 1');
        await createTables(pool);
        await upsertSections(pool);
        const result = await importQuestions(pool);
        console.log(`[three-week] imported ${result.savedRows}/${result.totalRows} rows`);
        if (result.warnings.length > 0) {
            console.warn('[three-week] warnings');
            result.warnings.forEach((warning) => console.warn(`- ${warning}`));
        }
        await printSummary(pool);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[three-week] import failed:', error);
        process.exitCode = 1;
    });
}
