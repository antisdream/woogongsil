// Practical-exam feature module for ipepPracticeUtils.
export function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = safeSeconds % 60;
    return `${h}시간 ${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;
}

export function formatDateTime(date) {
    if (!date) return '-';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}년 ${m}월 ${d}일 ${h}:${min}:${s}`;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
        .replaceAll('\n', '<br />');
}

export function replaceSettingTokens(text, values = {}) {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
}

export function getQuestionNo(question, index) {
    return Number(question?.questionNo || question?.subjectNo || index + 1);
}

export function getImgSrc(imgPath) {
    if (!imgPath) return '';
    if (String(imgPath).startsWith('http')) return imgPath;
    return imgPath;
}


// 서버의 채점 결과를 그대로 표시합니다. 자기채점은 점수 보정에 사용하지 않습니다.
export function mergeClientIpepGrade(question, responseData = {}) {
    return { ...responseData, maxScore: Number(responseData.maxScore || question?.score || 5),
        score: Number(responseData.score || 0), correctAnswer: responseData.correctAnswer || '' };
}

// 이미지 경로가 DB 저장 방식에 따라 camelCase, snake_case, 파일명 단독 등으로 섞여도
// 화면에서는 항상 브라우저 접근 가능한 /ipep-img/random 또는 /ipep-img/past 경로로 맞춰줍니다.
function resolveIpepImagePath(raw, question) {
    if (!raw) return '';

    const value = String(raw).trim();
    if (!value) return '';

    // 서버에서 이미 웹 경로 또는 외부 URL을 내려준 경우 그대로 사용합니다.
    if (value.startsWith('http')) return value;
    if (value.startsWith('/ipep-img/')) return value;

    // DB에 Windows 실제 경로 또는 파일명만 들어간 경우 파일명만 추출합니다.
    const fileName = value.split(/[\\/]/).pop();
    if (!fileName) return '';

    // 기출문제는 past, 3주 공략은 three-week, 문제은행은 random 정적 경로를 사용합니다.
    const imageType = question?.source === 'ipep_past' || question?.examYear || question?.exam_year
        ? 'past'
        : question?.source === 'ipep_three_week' || question?.sectionNo || question?.section_no
            ? 'three-week'
            : 'random';
    return `/ipep-img/${imageType}/${encodeURIComponent(fileName)}`;
}

// 실기 보기 이미지 필드명을 한 곳에서 흡수합니다.
export function getQuestionChoiceImgPath(question) {
    if (!question) return '';

    const raw = question.choiceImgPath
        || question.choice_img_path
        || question.choiceImagePath
        || question.choiceImage
        || question.questionImgPath
        || question.question_img
        || question.imagePath
        || question.image
        || question.choice_img_file
        || question.choiceImgFile
        || '';

    return resolveIpepImagePath(raw, question);
}

// 실기 해설 이미지 필드명을 한 곳에서 흡수합니다.
export function getQuestionExplanationImgPath(question) {
    if (!question) return '';

    const raw = question.explanationImgPath
        || question.explanation_img_path
        || question.explanationImagePath
        || question.explanationImage
        || question.explanation_img_file
        || question.explanationImgFile
        || '';

    return resolveIpepImagePath(raw, question);
}


// - 실제 서비스 기준: 2020년은 1~4회차, 2021~2025년은 1~3회차입니다.
// - 백엔드 카탈로그 응답에 특정 회차가 누락되어도 화면에서 연도/회차 자체가 사라지지 않도록 안전하게 병합합니다.
// - 서버가 내려준 isOpen/questionCount/noticeMessage가 있으면 그 값을 우선 사용합니다.
export function normalizeIpepCatalog(rows) {
    const serverRows = Array.isArray(rows) ? rows : [];
    const byKey = new Map(serverRows.map(row => [`${Number(row.examYear)}-${Number(row.examSession)}`, row]));
    const expectedRows = [];

    for (let year = 2020; year <= 2025; year += 1) {
        const maxSession = year === 2020 ? 4 : 3;
        for (let session = 1; session <= maxSession; session += 1) {
            const key = `${year}-${session}`;
            const serverRow = byKey.get(key);

            expectedRows.push({
                examYear: year,
                examSession: session,
                // 기존 서버 값이 있으면 유지하고, 누락된 2020년 회차는 기존 데이터 접근 가능성을 위해 오픈 상태로 둡니다.
                isOpen: serverRow ? Number(serverRow.isOpen) : (year === 2020 ? 1 : 0),
                questionCount: Number(serverRow?.questionCount ?? 20),
                noticeMessage: serverRow?.noticeMessage || '현재 오픈베타 테스트 중으로, 빠른 시일 내에 추가할 예정입니다.'
            });
        }
    }

    return expectedRows.sort((a, b) => {
        if (Number(b.examYear) !== Number(a.examYear)) return Number(b.examYear) - Number(a.examYear);
        return Number(a.examSession) - Number(b.examSession);
    });
}

// 시험 시작 버튼 클릭 직후 전체화면을 요청합니다.
// 브라우저는 사용자 클릭 없이 전체화면 전환을 막는 경우가 많아서, 실기 기출 시작 함수 안에서 호출합니다.
export function requestExamFullscreen() {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    } catch (error) {
        // 전체화면 실패는 브라우저 정책 문제일 수 있으므로 시험 시작 자체는 계속 진행합니다.
        console.warn('실기 기출 전체화면 요청 실패:', error);
    }
}
