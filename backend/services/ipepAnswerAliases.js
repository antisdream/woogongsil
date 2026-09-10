'use strict';
// Existing input aliases are evaluated only on the server.
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

function evaluateIpepAnswerAliases({ question, responseData = {}, userAnswer }) {
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
            compareMode: 'SERVER_ALIAS_SINGLE'
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
            compareMode: 'SERVER_ALIAS_MULTI_LENGTH_MISMATCH'
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
        compareMode: 'SERVER_ALIAS_MULTI_ORDERED'
    };
}

module.exports = { evaluateIpepAnswerAliases };
