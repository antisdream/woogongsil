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


// 실기 주관식 답안 예외처리 유틸
// ----------------------------------------------------------
// 목적:
// 1. 사용자가 입력하기 어려운 특수문자/원형문자/영문 대소문자 차이를 보정합니다.
// 2. DB 정답에 "애자일|Agile"처럼 | 로 별칭이 들어간 경우 어느 쪽을 입력해도 정답으로 인정합니다.
// 3. "원자성|Atomicity, 독립성|Isolation"처럼 여러 답이 필요한 경우 각 위치별 별칭을 조합해서 인정합니다.
// 4. 백엔드 채점 결과를 완전히 대체하지 않고, 프론트에서 명백히 정답으로 볼 수 있는 경우만 보정합니다.
//  즉, 기존 채점 API/랭킹/오답노트 흐름은 유지하면서 사용자 입력 허용 범위만 넓힙니다.
const CIRCLED_HANGUL_MAP = {
    '㉠': 'ㄱ', '㉡': 'ㄴ', '㉢': 'ㄷ', '㉣': 'ㄹ', '㉤': 'ㅁ',
    '㉥': 'ㅂ', '㉦': 'ㅅ', '㉧': 'ㅇ', '㉨': 'ㅈ', '㉩': 'ㅊ',
    '㉪': 'ㅋ', '㉫': 'ㅌ', '㉬': 'ㅍ', '㉭': 'ㅎ'
};

const CIRCLED_NUMBER_MAP = {
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
    '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
    '⑪': '11', '⑫': '12', '⑬': '13', '⑭': '14', '⑮': '15',
    '⑯': '16', '⑰': '17', '⑱': '18', '⑲': '19', '⑳': '20'
};

function normalizeIpepAnswerText(value) {
    let text = String(value ?? '').trim();

    // 유니코드 호환 문자 정리: 전각 영문/숫자, 일부 특수문자를 일반 형태로 최대한 맞춥니다.
    try {
        text = text.normalize('NFKC');
    } catch (error) {
        // 일부 구형 브라우저 예외 가능성에 대비합니다. 정규화 실패 시 원문으로 계속 처리합니다.
    }

    // 사용자가 입력하기 어려운 원형 한글을 일반 자음으로 인정합니다.
    // 예: ㉡, ㉢, ㉠, ㉣, ㉤ === ㄴ, ㄷ, ㄱ, ㄹ, ㅁ
    text = text.replace(/[㉠-㉭]/g, (char) => CIRCLED_HANGUL_MAP[char] || char);

    // ①, ② 같은 원형 숫자는 일반 숫자로 비교합니다.
    text = text.replace(/[①-⑳]/g, (char) => CIRCLED_NUMBER_MAP[char] || char);

    // 키보드 입력이 어려운 기호의 대체 입력을 인정합니다.
    // - 나눗셈 기호는 / 로 입력해도 정답 처리합니다
    // - 곱셈 기호는 * 또는 x 입력과 비교될 수 있도록 * 로 통일
    text = text
        .replace(/[\u00F7\u2215\uFF0F]/g, '/')
        .replace(/[\u00D7\u2715]/g, '*')
        .replace(/[，、]/g, ',')
        .replace(/[；]/g, ';')
        .replace(/[：]/g, ':');

    // 영문 대소문자 차이를 제거합니다. Class, class, CLASS 모두 같은 값으로 비교됩니다.
    text = text.toLowerCase();

    // 답안 앞에 붙는 번호 표기를 제거합니다.
    // 예: "1) 클래스", "① 클래스", "ㄱ. 관계"처럼 입력해도 핵심 답만 비교합니다.
    text = text.replace(/^\s*(?:\(?\d+\)?|[ㄱ-ㅎ])\s*[.)번:：-]\s*/g, '');

    // 불필요한 따옴표/괄호/마침표 등은 비교에서 제외합니다.
    // 단, /, *, +, -, = 처럼 답이 될 수 있는 기호는 유지합니다.
    text = text.replace(/["'`“”‘’[\]{}()<>]/g, '');
    text = text.replace(/[.!?。]+$/g, '');

    // 공백 차이를 제거합니다.
    // 예: "Package Diagram"과 "packagediagram", "패키지 다이어그램"과 "패키지다이어그램"을 같은 답으로 봅니다.
    text = text.replace(/\s+/g, '');

    return text.trim();
}

function splitIpepAnswerGroups(value) {
    const text = String(value ?? '').trim();
    if (!text) return [];

    // 여러 답안은 쉼표, 줄바꿈, 세미콜론 기준으로 나눕니다.
    // slash(/)는 ÷의 대체 입력일 수 있으므로 구분자로 쓰지 않습니다.
    return text
        .split(/[,\n\r;]+/g)
        .map(part => part.trim())
        .filter(Boolean);
}

function splitIpepAnswerAlternatives(groupText) {
    // DB 정답의 | 는 별칭 구분자로 사용합니다.
    // 예: 클래스|Class 는 클래스 또는 class 모두 정답
    return String(groupText ?? '')
        .split('|')
        .map(part => part.trim())
        .filter(Boolean);
}

function getQuestionCorrectAnswer(question, responseData = {}) {
    // 백엔드 응답과 문제 객체에 섞여 있을 수 있는 정답 필드명을 한 곳에서 흡수합니다.
    return responseData.correctAnswer
        || responseData.correct_answer
        || question?.correctAnswer
        || question?.correct_answer
        || question?.answerRaw
        || question?.answer_raw
        || question?.answerNormalized
        || question?.answer_normalized
        || '';
}

function buildUserGroupsForIpepCompare(userAnswer, expectedGroupCount) {
    const normalGroups = splitIpepAnswerGroups(userAnswer);

    // 사용자가 "기능 비기능"처럼 쉼표 없이 공백으로만 여러 답을 쓴 경우를 보정합니다.
    // 단, 정답이 1개인 "패키지 다이어그램" 같은 답은 쪼개면 안 되므로 expectedGroupCount가 2개 이상일 때만 동작합니다.
    if (expectedGroupCount >1 && normalGroups.length === 1) {
        const whitespaceParts = String(userAnswer ?? '')
            .trim()
            .split(/\s+/g)
            .map(part => part.trim())
            .filter(Boolean);

        if (whitespaceParts.length === expectedGroupCount) {
            return whitespaceParts;
        }
    }

    return normalGroups;
}

function evaluateIpepAnswerByClient({ question, responseData = {}, userAnswer }) {
    const correctAnswer = getQuestionCorrectAnswer(question, responseData);
    const maxScore = Number(responseData.maxScore || question?.score || 5);

    const correctGroups = splitIpepAnswerGroups(correctAnswer);
    if (!String(userAnswer || '').trim() || correctGroups.length === 0) {
        return {
            canEvaluate: false,
            isCorrect: false,
            score: 0,
            maxScore,
            correctAnswer
        };
    }

    const userGroups = buildUserGroupsForIpepCompare(userAnswer, correctGroups.length);
    if (userGroups.length === 0) {
        return {
            canEvaluate: false,
            isCorrect: false,
            score: 0,
            maxScore,
            correctAnswer
        };
    }

    // 정답이 1개인 문제 처리합니다
    // 예: 클래스|Class, 애자일|Agile, 20개월|20, ÷ 등
    if (correctGroups.length === 1) {
        const normalizedUser = normalizeIpepAnswerText(userAnswer);
        const alternatives = splitIpepAnswerAlternatives(correctGroups[0]).map(normalizeIpepAnswerText);
        const matched = alternatives.some(answer => answer && answer === normalizedUser);

        return {
            canEvaluate: true,
            isCorrect: matched,
            score: matched ? maxScore : 0,
            maxScore,
            correctAnswer,
            matchedCount: matched ? 1 : 0,
            expectedCount: 1,
            compareMode: 'CLIENT_ALIAS_SINGLE'
        };
    }

    // 여러 답이 필요한 문제 처리합니다
    // 예: 원자성|Atomicity, 독립성|Isolation
    // 사용자는 "원자성, isolation"처럼 각 위치별로 한글/영문을 섞어 입력할 수 있습니다.
    if (userGroups.length !== correctGroups.length) {
        return {
            canEvaluate: true,
            isCorrect: false,
            score: 0,
            maxScore,
            correctAnswer,
            matchedCount: 0,
            expectedCount: correctGroups.length,
            compareMode: 'CLIENT_ALIAS_MULTI_LENGTH_MISMATCH'
        };
    }

    let matchedCount = 0;
    for (let i = 0; i < correctGroups.length; i += 1) {
        const normalizedUser = normalizeIpepAnswerText(userGroups[i]);
        const alternatives = splitIpepAnswerAlternatives(correctGroups[i]).map(normalizeIpepAnswerText);
        const matched = alternatives.some(answer => answer && answer === normalizedUser);
        if (matched) matchedCount += 1;
    }

    const isCorrect = matchedCount === correctGroups.length;
    return {
        canEvaluate: true,
        isCorrect,
        // 프론트 예외처리는 전체 일치가 확인된 경우에만 만점으로 보정합니다.
        // 부분점수 정책은 기존 백엔드 채점 결과를 우선 유지합니다.
        score: isCorrect ? maxScore : 0,
        maxScore,
        correctAnswer,
        matchedCount,
        expectedCount: correctGroups.length,
        compareMode: 'CLIENT_ALIAS_MULTI_ORDERED'
    };
}

export function mergeClientIpepGrade(question, responseData = {}, userAnswer = '') {
    const serverData = responseData || {};
    const maxScore = Number(serverData.maxScore || question?.score || 5);
    const serverScore = Number(serverData.score || 0);
    const clientGrade = evaluateIpepAnswerByClient({ question, responseData: serverData, userAnswer });

    // 백엔드가 이미 정답 또는 부분점수로 판단한 경우에는 기존 결과를 그대로 존중합니다.
    if (serverData.isCorrect || serverScore >0) {
        return {
            ...serverData,
            score: serverScore,
            maxScore,
            correctAnswer: getQuestionCorrectAnswer(question, serverData),
            detail: {
                ...(serverData.detail || {}),
                clientCompareMode: clientGrade.compareMode || 'CLIENT_NOT_NEEDED'
            }
        };
    }

    // 백엔드가 오답으로 봤지만 프론트 예외처리상 명백히 정답이면 정답으로 보정합니다.
    // 예: Class/class/클래스, ㉡ 대신 ㄴ, ÷ 대신 /, 원자성+isolation 조합 등
    if (clientGrade.canEvaluate && clientGrade.isCorrect) {
        return {
            ...serverData,
            isCorrect: true,
            score: clientGrade.score,
            maxScore: clientGrade.maxScore,
            correctAnswer: clientGrade.correctAnswer,
            detail: {
                ...(serverData.detail || {}),
                compareMode: clientGrade.compareMode,
                clientMatchedCount: clientGrade.matchedCount,
                clientExpectedCount: clientGrade.expectedCount,
                clientExceptionApplied: true
            }
        };
    }

    // 어느 쪽에서도 정답으로 볼 수 없으면 기존 결과를 유지합니다.
    return {
        ...serverData,
        isCorrect: Boolean(serverData.isCorrect),
        score: serverScore,
        maxScore,
        correctAnswer: getQuestionCorrectAnswer(question, serverData),
        detail: {
            ...(serverData.detail || {}),
            clientCompareMode: clientGrade.compareMode || 'CLIENT_NO_MATCH'
        }
    };
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
