'use strict';

const ROOM_STATUSES = {
    WAITING: 'WAITING',
    PLAYING: 'PLAYING',
    FINISHED: 'FINISHED',
    CANCELLED: 'CANCELLED'
};

const MEMBER_STATUSES = {
    JOINED: 'JOINED',       // 대기방에 입장했지만 아직 준비완료를 누르지 않은 상태
    READY: 'READY',         // 일반 참여자가 준비완료 버튼을 누른 상태
    PLAYING: 'PLAYING',     // 시험 진행 중
    SUBMITTED: 'SUBMITTED', // 답안 제출 완료
    LEFT: ' LEFT'            // 대기방 나가기 또는 내보내기 처리된 상태
};

const SUBJECT_NAMES = [
    '1과목 : 소프트웨어 설계',
    '2과목 : 소프트웨어 개발',
    '3과목 : 데이터베이스 구축',
    '4과목 : 프로그래밍 언어 활용',
    '5과목 : 정보시스템 구축 관리'
];

// 방 생성 시 필기/실기를 명확히 분리하기 위한 공통 상수다.
const MP_EXAM_TYPES = Object.freeze({ WRITTEN: 'written', IPEP: 'ipep' });
function normalizeMpExamType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (['ipep', 'practical', '실기', '실기문제', '정보처리기사실기'].includes(raw)) return MP_EXAM_TYPES.IPEP;
    return MP_EXAM_TYPES.WRITTEN;
}
function getMpExamTypeLabel(value) { return normalizeMpExamType(value) === MP_EXAM_TYPES.IPEP ? '실기 기출문제' : '필기 기출문제'; }
function isIpepExam(value) { return normalizeMpExamType(value) === MP_EXAM_TYPES.IPEP; }
function normalizeMpAnswer(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\\n/g, '\n')
        .replace(/[“”‘’"']/g, '')
        .replace(/[.,。·!?:;，、_\-—–\/\\()[\]{}<>|]/g, '')
        .replace(/\s+/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
}
function parseMpAliasList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
    } catch (error) {
        // answer_aliases_json이 JSON이 아닌 쉼표 문자열이어도 채점 가능하게 처리합니다.
    }
    return String(value).split(/[|,]/).map((item) => item.trim()).filter(Boolean);
}
function isIpepAnswerCorrect(selectedAnswer, question) {
    const userAnswer = normalizeMpAnswer(selectedAnswer);
    if (!userAnswer) return false;
    const candidates = [question.answer, question.correct_label, question.answer_raw, question.correct_answer, ...parseMpAliasList(question.answer_aliases_json), ...parseMpAliasList(question.answer_keywords)].map(normalizeMpAnswer).filter(Boolean);
    return candidates.some((answer) => answer === userAnswer);
}


// 멀티플레이 랜덤 출제 시 같은 내용의 문제가 반복 노출되지 않도록
// 질문/보기/정답을 정규화한 뒤, 먼저 뽑힌 문제를 살리고 뒤에 나온 유사 문제는 건너뜁니다.
function normalizeMultiplayerText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ')
        .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, '');
}

function makeNgramSet(value, size = 3) {
    const text = normalizeMultiplayerText(value);
    const result = new Set();
    if (!text) return result;
    if (text.length <= size) {
        result.add(text);
        return result;
    }
    for (let i = 0; i <= text.length - size; i += 1) {
        result.add(text.slice(i, i + size));
    }
    return result;
}

function ngramSimilarity(left, right) {
    const a = makeNgramSet(left);
    const b = makeNgramSet(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection += 1;
    }
    return (intersection * 2) / (a.size + b.size);
}

function buildWrittenDuplicateInfo(row) {
    const question = normalizeMultiplayerText(row.question);
    const combined = normalizeMultiplayerText([
        row.question,
        row.opt1,
        row.opt2,
        row.opt3,
        row.opt4,
        row.question_img,
    ].filter(Boolean).join(' '));
    return { question, combined };
}

function buildPracticalDuplicateInfo(row) {
    const question = normalizeMultiplayerText(row.question_text);
    const answer = normalizeMultiplayerText(row.answer_raw);
    const combined = normalizeMultiplayerText([
        row.question_text,
        row.answer_raw,
        row.question_img,
        row.image_path,
    ].filter(Boolean).join(' '));
    return { question, answer, combined };
}

function isWrittenDuplicate(current, selectedInfos) {
    for (const previous of selectedInfos) {
        if (current.combined && previous.combined && current.combined === previous.combined) return true;
        if (current.question && previous.question && current.question === previous.question) return true;

        // 너무 짧은 문장은 우연히 비슷해질 수 있어 충분한 길이의 문장만 유사도 예외처리를 적용합니다.
        if (current.combined.length >= 35 && previous.combined.length >= 35 && ngramSimilarity(current.combined, previous.combined) >= 0.94) return true;
        if (current.question.length >= 28 && previous.question.length >= 28 && ngramSimilarity(current.question, previous.question) >= 0.94) return true;
    }
    return false;
}

function isPracticalDuplicate(current, selectedInfos) {
    for (const previous of selectedInfos) {
        if (current.combined && previous.combined && current.combined === previous.combined) return true;
        if (current.question && previous.question && current.answer && previous.answer && current.question === previous.question && current.answer === previous.answer) return true;

        const sameAnswer = current.answer && previous.answer && (current.answer === previous.answer || ngramSimilarity(current.answer, previous.answer) >= 0.96);
        const similarQuestion = current.question.length >= 20 && previous.question.length >= 20 && ngramSimilarity(current.question, previous.question) >= 0.92;
        if (sameAnswer && similarQuestion) return true;
    }
    return false;
}

function pickUniqueMultiplayerRows(rows, targetCount, buildInfo, isDuplicate) {
    const selectedRows = [];
    const selectedInfos = [];

    for (const row of rows) {
        const info = buildInfo(row);
        const hasText = Object.values(info).some((value) => value && value.length >0);
        if (!hasText) continue;
        if (isDuplicate(info, selectedInfos)) continue;

        selectedRows.push(row);
        selectedInfos.push(info);
        if (selectedRows.length >= targetCount) break;
    }

    return selectedRows;
}


// questions.subject 값이 숫자(1~5)일 수도 있고, 과목명 문자열일 수도 있어서
// SQL에서 안전하게 1~5 과목 번호로 변환하기 위한 CASE 문입니다.
const SUBJECT_NO_SQL = `CASE
        /*
         * 프로젝트 DB의 필기 questions.subject 매핑
         *  10 : 1과목 소프트웨어 설계
         *  11 : 2과목 소프트웨어 개발
         *  12 : 3과목 데이터베이스 구축
         *  13 : 4과목 프로그래밍 언어 활용
         *  14 : 5과목 정보시스템 구축 관리합니다
         *
         * 이전 v3 오류 원인:
         *  q.subject LIKE '1%' 조건 때문에 10, 11, 12, 13, 14가 전부 1과목으로 계산되었다.
         *  그래서 화면에는 1과목 1500개, 2~5과목 0개처럼 표시되고 시험 시작 시 2과목 0문제 오류가 났다.
         *
         * 현재 동작:
         *  10~14를 가장 먼저 정확히 1~5과목으로 변환합니다.
         *  그 다음 혹시 다른 환경에서 1~5 또는 과목명 문자열로 들어온 경우만 보정합니다.
         *  마지막 안전장치로 info_id 1~100 범위를 20문제 단위로 나눠 과목을 추정합니다.
         */
        WHEN CAST(q.subject AS UNSIGNED) BETWEEN 10 AND 14 THEN CAST(q.subject AS UNSIGNED) - 9
        WHEN CAST(q.subject AS UNSIGNED) BETWEEN 1 AND 5 THEN CAST(q.subject AS UNSIGNED)
        WHEN CAST(q.subject AS CHAR) LIKE '%소프트웨어 설계%'THEN 1
        WHEN CAST(q.subject AS CHAR) LIKE '%소프트웨어 개발%'THEN 2
        WHEN CAST(q.subject AS CHAR) LIKE '%데이터베이스%'THEN 3
        WHEN CAST(q.subject AS CHAR) LIKE '%프로그래밍%'THEN 4
        WHEN CAST(q.subject AS CHAR) LIKE '%정보시스템%'THEN 5
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 1 AND 20 THEN 1
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 21 AND 40 THEN 2
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 41 AND 60 THEN 3
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 61 AND 80 THEN 4
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 81 AND 100 THEN 5
        ELSE NULL
    END
`;

function normalizeRoomCode(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 3);
}

function normalizePassword(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 6);
}

function normalizeInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function getSocketRoomName(roomCode) {
    return `wgs-written-multiplayer-room-${roomCode}`;
}

function isValidRoomCode(roomCode) {
    const n = Number(roomCode);
    return /^\d{1,3}$/.test(String(roomCode || '')) && n >= 1 && n <= 999;
}

function isValidRoomPassword(password) {
    const n = Number(password);
    return /^\d{1,6}$/.test(String(password || '')) && n >= 1 && n <= 999999;
}

function getSubjectNameByNo(subjectNo) {
    return SUBJECT_NAMES[Math.min(4, Math.max(0, Number(subjectNo || 1) - 1))];
}

function makeQuestionImageWebPath(imageName) {
    // 필기 보기 이미지 경로 보정
    // ------------------------------------------------------------
    // 필기 문제의 <보기> 이미지는 questions.question_img에 저장되어 있고,
    // 기존 기출/문제은행 화면은 /question_image 정적 경로에서 렌더링합니다.
    // HTML/PDF용 오답 정리도 같은 경로를 쓰도록 웹 경로를 함께 내려줍니다.
    const value = String(imageName || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
    return `/question_image/${value}`;
}

function buildWrittenQuestionImageFields(row) {
    // 보기 이미지 필드 호환 처리합니다
    // ------------------------------------------------------------
    // 현재 필기 DB는 question_img만 가지고 있지만, 프론트 HTML 생성부가
    // choice_img_stem / choice_img_file / choice_img_path 계열도 같이 받을 수
    // 있게 별칭을 만들어줍니다. 실기 테이블은 변경하지 않는다.
    const fileName = String(row.question_img || row.choice_img_file || '').trim();
    const webPath = makeQuestionImageWebPath(row.choice_img_path || fileName);
    const stem = String(row.choice_img_stem || fileName.replace(/\.[^/.]+$/, '') || '').trim();

    return {
        question_img: fileName,
        questionImg: fileName,
        choice_img_stem: stem,
        choice_img_file: fileName,
        choice_img_path: webPath,
        choiceImgPath: webPath,
        questionImgPath: webPath,
        imagePath: webPath,
        image: webPath
    };
}

function sanitizeQuestionForClient(row, includeAnswer = false) {
    // 시험 중에는 정답/해설을 숨기고, 제출 후에만 포함합니다.
    const questionSource = row.question_source || row.question_kind || MP_EXAM_TYPES.WRITTEN;
    const item = {
        question_id: row.question_id,
        question_order: Number(row.question_order || 0),
        cbtNo: Number(row.question_order || 0),
        questionSource,
        questionKind: questionSource,
        question_text: row.question_text || '',
        ...(questionSource === MP_EXAM_TYPES.IPEP ? {} : buildWrittenQuestionImageFields(row)),
        option_1: row.option_1 || '',
        option_2: row.option_2 || '',
        option_3: row.option_3 || '',
        option_4: row.option_4 || '',
        options: [row.option_1, row.option_2, row.option_3, row.option_4].map((v) => v || ''),
        sourceLabel: includeAnswer
            ? (row.source_label || (questionSource === MP_EXAM_TYPES.IPEP
                ? `${row.year || ''}년 ${row.session || row.round || ''}회 실기 ${row.info_id || row.question_no || ''}번`
                : `${row.year || ''}년 ${row.session || ''}회 ${row.subject_name || ''} ${row.info_id || ''}번`))
            : '랜덤 CBT 문제',
        // 오류신고 메일에는 랜덤 출제 문제의 실제 출처가 필요하므로 정답과 무관한 식별 메타데이터만 항상 내려줍니다.
        report_source_label: (row.source_label || (questionSource === MP_EXAM_TYPES.IPEP
            ? `${row.year || ''}년 ${row.session || row.round || ''}회 실기 ${row.info_id || row.question_no || ''}번`
            : `${row.year || ''}년 ${row.session || ''}회 ${row.subject_name || ''} ${row.info_id || ''}번`)).trim(),
        exam_year: row.year || row.exam_year || row.source_year || null,
        exam_session: row.session || row.round || row.exam_session || row.source_session || null,
        source_year: row.year || row.exam_year || row.source_year || null,
        source_session: row.session || row.round || row.exam_session || row.source_session || null,
        subject_no: Number(row.subject_no || (questionSource === MP_EXAM_TYPES.IPEP ? 6 : Math.ceil(Number(row.question_order || 1) / 20))),
        subject_name: row.subject_name || (questionSource === MP_EXAM_TYPES.IPEP ? '정보처리기사 실기' : getSubjectNameByNo(Math.ceil(Number(row.question_order || 1) / 20))),
        question_no: row.question_no || row.info_id || null,
        info_id: row.info_id || null,
        imagePath: questionSource === MP_EXAM_TYPES.IPEP ? (row.image_path || '') : (row.imagePath || row.image_path || '')
    };

    if (includeAnswer) {
        item.info_id = row.info_id;
        item.subject_id = row.subject_id;
        item.subject_no = Number(row.subject_no || (questionSource === MP_EXAM_TYPES.IPEP ? 6 : Math.ceil(Number(row.question_order || 1) / 20)));
        item.subject_name = row.subject_name || (questionSource === MP_EXAM_TYPES.IPEP ? '정보처리기사 실기' : getSubjectNameByNo(Math.ceil(Number(row.question_order || 1) / 20)));
        item.year = row.year;
        item.session = row.session || row.round;
        item.correct_label = row.correct_label;
        item.correct_answer = row.correct_label;
        item.answer = row.correct_label;
        item.explanation = row.explanation || '';
        item.explanation_text = row.explanation || '';
        item.explanation_img_path = row.explanation_img_path || row.explanation_image || '';
        item.explanationImgPath = row.explanation_img_path || row.explanation_image || '';
        item.answer_aliases_json = row.answer_aliases_json || null;
    }

    return item;
}


module.exports = {
    ROOM_STATUSES,
    MEMBER_STATUSES,
    SUBJECT_NAMES,
    MP_EXAM_TYPES,
    SUBJECT_NO_SQL,
    normalizeMpExamType,
    getMpExamTypeLabel,
    isIpepExam,
    normalizeMpAnswer,
    parseMpAliasList,
    isIpepAnswerCorrect,
    normalizeMultiplayerText,
    makeNgramSet,
    ngramSimilarity,
    buildWrittenDuplicateInfo,
    buildPracticalDuplicateInfo,
    isWrittenDuplicate,
    isPracticalDuplicate,
    pickUniqueMultiplayerRows,
    normalizeRoomCode,
    normalizePassword,
    normalizeInt,
    getSocketRoomName,
    isValidRoomCode,
    isValidRoomPassword,
    getSubjectNameByNo,
    makeQuestionImageWebPath,
    buildWrittenQuestionImageFields,
    sanitizeQuestionForClient
};
