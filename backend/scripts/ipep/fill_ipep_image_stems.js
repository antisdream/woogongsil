// fill_ipep_image_stems.js
// 역할:
// 1. 정보처리기사 실기 CSV의 "문제보기", "문제해설" 컬럼을 자동으로 채운다.
// 2. CSV에 이미지 파일명을 하나씩 직접 입력하지 않아도 되도록 보조합니다.
// 3. 이미지 폴더 안의 파일명을 stem 기준으로 찾는다.
//  - 예: 2020010107.png 파일이 있으면 CSV에는 2020010107 이라고 저장합니다.
//  - 확장자 png, jpg, jpeg, webp가 섞여 있어도 처리합니다.
// 4. 기존 CSV는 실행 전 자동 백업합니다.
// 5. 이 스크립트는 DB를 직접 변경하지 않는다. CSV만 보정합니다.
// 6. CSV 보정 후 load_ipep_csv.js를 실행해 SQL에 다시 적재합니다.
// 실행 위치:
// ExamAppProject/backend
// 기본 실행:
// node fill_ipep_image_stems.js
// 이미 채워진 문제보기/문제해설 값까지 새 규칙으로 다시 덮어쓰고 싶을 때:
// node fill_ipep_image_stems.js --overwrite

// fs는 파일/폴더 존재 여부 확인, 파일 읽기/쓰기에 사용합니다.
const fs = require('fs');

// path는 Windows 경로를 안전하게 합치기 위해 사용합니다.
const path = require('path');

// csv-parse는 쉼표, 따옴표, 줄바꿈이 섞인 CSV를 안전하게 읽기 위해 사용합니다.
const { parse } = require('csv-parse/sync');

// 이 스크립트가 들어 있는 폴더다.
// 프로젝트 기준 경로: ExamAppProject/backend
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const IPEP_DATA_DIR = path.join(BACKEND_DIR, 'data', 'ipep', 'source');
const IPEP_IMAGE_DIR = path.join(BACKEND_DIR, 'public', 'ipep-img');
const BASE_DIR = BACKEND_DIR;

// 문제은행 CSV 파일 경로다.
const RANDOM_CSV_PATH = path.join(IPEP_DATA_DIR, 'random_ipep.csv');

// 기출문제 CSV 파일 경로다.
const PAST_CSV_PATH = path.join(IPEP_DATA_DIR, 'past_ipep.csv');

// 문제은행 이미지 폴더 경로다.
const RANDOM_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'random');

// 기출문제 이미지 폴더 경로다.
const PAST_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'past');

// 재생성 옵션입니다.
// 기본은 false라서 이미 CSV에 값이 있으면 변경하지 않는다.
const OVERWRITE_EXISTING = process.argv.includes('--overwrite');

// 허용할 이미지 확장자 목록입니다.
const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// CSV 컬럼명입니다.
// 오타를 줄이기 위해 한 곳에 모아둡니다.
const RANDOM_COLUMNS = ['과목코드', '과목번호', '문제질문', '문제정답', '문제보기', '문제해설'];
const PAST_COLUMNS = ['기출연도', '기출회차', '문제번호', '문제질문', '문제정답', '문제보기', '문제해설'];

// 값이 null/undefined여도 안전하게 문자열로 바꾼 뒤 앞뒤 공백을 제거합니다.
function cleanText(value) {
    return String(value ?? '').trim();
}

// 숫자를 지정한 자리수만큼 0으로 채운다.
// 예: padNumber(1, 2) => "01"
function padNumber(value, size) {
    return String(Number(value)).padStart(size, '0');
}

// 현재 시간을 파일명에 넣기 좋은 형태로 만든다.
// 백업 파일명이 겹치지 않도록 쓰는 값입니다.
function getTimestamp() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}_${h}${min}${s}`;
}

// CSV 파일을 읽어서 객체 배열로 바꾼다.
function readCsv(csvPath) {
    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
    }

    const raw = fs.readFileSync(csvPath, 'utf8');

    return parse(raw, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: false,
        relax_quotes: true,
        relax_column_count: true
    });
}

// CSV 한 칸을 안전하게 저장하기 위해 큰따옴표로 감싼다.
// 값 안에 큰따옴표가 있으면 CSV 규칙에 맞게 두 번 적는다.
function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
}

// 객체 배열을 CSV 텍스트로 바꾼다.
// 모든 칸을 큰따옴표로 감싸서 쉼표/줄바꿈이 있어도 안전하게 저장합니다.
function buildCsvText(rows, columns) {
    const header = columns.map(csvCell).join(',');
    const body = rows.map(row => columns.map(col => csvCell(row[col])).join(',')).join('\r\n');
    return `\uFEFF${header}\r\n${body}\r\n`;
}

// 원본 CSV를 백업합니다.
// 실수해도 언제든 백업 파일로 되돌릴 수 있게 하기 위한 안전장치다.
function backupCsv(csvPath) {
    const dir = path.dirname(csvPath);
    const ext = path.extname(csvPath);
    const base = path.basename(csvPath, ext);
    const backupPath = path.join(dir, `${base}.backup_before_image_stem_${getTimestamp()}${ext}`);
    fs.copyFileSync(csvPath, backupPath);
    return backupPath;
}

// 이미지 폴더를 읽어서 stem 목록을 만든다.
// 예: 2020010107.png => stem은 2020010107 이다.
function collectImageStems(imageDir) {
    const result = new Map();

    if (!fs.existsSync(imageDir)) {
        return result;
    }

    const files = fs.readdirSync(imageDir);

    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const stem = path.basename(file, ext);

        if (ALLOWED_EXTS.has(ext)) {
            result.set(stem, file);
        }
    }

    return result;
}

// 후보 stem 중 실제 이미지 폴더에 존재하는 첫 번째 stem을 반환합니다.
function findExistingStem(stemMap, candidates) {
    for (const stem of candidates) {
        if (stemMap.has(stem)) {
            return stem;
        }
    }
    return '';
}

// 문제은행 이미지 파일명 후보를 만든다.
// public/ipep-img/random 파일명은 달라질 수 있어 여러 후보 규칙을 지원합니다.
// 권장 규칙은 R + 과목코드2자리 + 과목번호3자리 + 06/07 이다.
// 예: 과목코드 01, 과목번호 9, 해설 이미지 => R0100907
function buildRandomStemCandidates(subjectCode, subjectNo, kindCode) {
    const code = cleanText(subjectCode).padStart(2, '0');
    const no2 = padNumber(subjectNo, 2);
    const no3 = padNumber(subjectNo, 3);
    const no4 = padNumber(subjectNo, 4);

    return [
        `R${code}${no3}${kindCode}`,
        `R${code}${no2}${kindCode}`,
        `R${code}${no4}${kindCode}`,
        `${code}${no3}${kindCode}`,
        `${code}${no2}${kindCode}`,
        `${code}${no4}${kindCode}`
    ];
}

// 기출문제 이미지 파일명 후보를 만든다.
// 규칙: 기출연도4자리 + 기출회차2자리 + 문제번호2자리 + 06/07
// 예: 2020년 1회차 1번 해설 이미지 =>2020010107
function buildPastStemCandidates(examYear, examSession, questionNo, kindCode) {
    const year = cleanText(examYear);
    const session = padNumber(examSession, 2);
    const no = padNumber(questionNo, 2);
    return [`${year}${session}${no}${kindCode}`];
}

// 비어 있는 셀만 채울지, 덮어쓸지 판단해서 값을 넣는다.
function setCellIfAllowed(row, columnName, nextValue) {
    if (!nextValue) {
        return false;
    }

    const currentValue = cleanText(row[columnName]);

    if (!OVERWRITE_EXISTING && currentValue) {
        return false;
    }

    row[columnName] = nextValue;
    return true;
}

// 문제은행 CSV의 문제보기/문제해설 stem을 자동 입력합니다.
function updateRandomCsv() {
    const rows = readCsv(RANDOM_CSV_PATH);
    const stemMap = collectImageStems(RANDOM_IMG_DIR);
    const backupPath = backupCsv(RANDOM_CSV_PATH);

    let choiceFilled = 0;
    let explanationFilled = 0;
    let choiceFound = 0;
    let explanationFound = 0;

    for (const row of rows) {
        const subjectCode = cleanText(row['과목코드']).padStart(2, '0');
        const subjectNo = Number(cleanText(row['과목번호']));

        const choiceStem = findExistingStem(stemMap, buildRandomStemCandidates(subjectCode, subjectNo, '06'));
        const explanationStem = findExistingStem(stemMap, buildRandomStemCandidates(subjectCode, subjectNo, '07'));

        if (choiceStem) choiceFound += 1;
        if (explanationStem) explanationFound += 1;

        if (setCellIfAllowed(row, '문제보기', choiceStem)) choiceFilled += 1;
        if (setCellIfAllowed(row, '문제해설', explanationStem)) explanationFilled += 1;
    }

    fs.writeFileSync(RANDOM_CSV_PATH, buildCsvText(rows, RANDOM_COLUMNS), 'utf8');

    return {
        csvPath: RANDOM_CSV_PATH,
        backupPath,
        totalRows: rows.length,
        imageCount: stemMap.size,
        choiceFound,
        explanationFound,
        choiceFilled,
        explanationFilled
    };
}

// 기출문제 CSV의 문제보기/문제해설 stem을 자동 입력합니다.
function updatePastCsv() {
    const rows = readCsv(PAST_CSV_PATH);
    const stemMap = collectImageStems(PAST_IMG_DIR);
    const backupPath = backupCsv(PAST_CSV_PATH);

    let choiceFilled = 0;
    let explanationFilled = 0;
    let choiceFound = 0;
    let explanationFound = 0;

    for (const row of rows) {
        const examYear = Number(cleanText(row['기출연도']));
        const examSession = Number(cleanText(row['기출회차']));
        const questionNo = Number(cleanText(row['문제번호']));

        const choiceStem = findExistingStem(stemMap, buildPastStemCandidates(examYear, examSession, questionNo, '06'));
        const explanationStem = findExistingStem(stemMap, buildPastStemCandidates(examYear, examSession, questionNo, '07'));

        if (choiceStem) choiceFound += 1;
        if (explanationStem) explanationFound += 1;

        if (setCellIfAllowed(row, '문제보기', choiceStem)) choiceFilled += 1;
        if (setCellIfAllowed(row, '문제해설', explanationStem)) explanationFilled += 1;
    }

    fs.writeFileSync(PAST_CSV_PATH, buildCsvText(rows, PAST_COLUMNS), 'utf8');

    return {
        csvPath: PAST_CSV_PATH,
        backupPath,
        totalRows: rows.length,
        imageCount: stemMap.size,
        choiceFound,
        explanationFound,
        choiceFilled,
        explanationFilled
    };
}

// 실행 결과를 보기 좋게 출력합니다.
function printResult(title, result) {
    console.log(`\n[${title}]`);
    console.log('CSV 경로:', result.csvPath);
    console.log('백업 파일:', result.backupPath);
    console.log('CSV 문제 수:', result.totalRows);
    console.log('이미지 폴더에서 발견한 이미지 수:', result.imageCount);
    console.log('보기 이미지 후보 발견:', result.choiceFound);
    console.log('해설 이미지 후보 발견:', result.explanationFound);
    console.log('CSV 문제보기 컬럼 입력:', result.choiceFilled);
    console.log('CSV 문제해설 컬럼 입력:', result.explanationFilled);
}

// 메인 실행 함수다.
function main() {
    console.log(' 실기 CSV 이미지 stem 자동 입력을 시작합니다.');
    console.log('BASE_DIR:', BASE_DIR);
    console.log('RANDOM_CSV_PATH:', RANDOM_CSV_PATH);
    console.log('PAST_CSV_PATH:', PAST_CSV_PATH);
    console.log('RANDOM_IMG_DIR:', RANDOM_IMG_DIR);
    console.log('PAST_IMG_DIR:', PAST_IMG_DIR);
    console.log('덮어쓰기 모드:', OVERWRITE_EXISTING ? ' ON' : 'OFF');

    const randomResult = updateRandomCsv();
    const pastResult = updatePastCsv();

    printResult('문제은행 CSV', randomResult);
    printResult('기출문제 CSV', pastResult);

    console.log('\n CSV 이미지 stem 자동 입력이 완료되었습니다.');
    console.log('다음 명령어로 SQL에 다시 적재하세요:');
    console.log('node load_ipep_csv.js');
}

try {
    main();
} catch (error) {
    console.error('\n CSV 이미지 stem 자동 입력 중 오류가 발생했습니다.');
    console.error(error);
    process.exit(1);
}
