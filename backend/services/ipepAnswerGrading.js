// IPEP answer grading and normalization helpers.
function cleanText(value) {
    // 값이 없으면 빈 문자열로 처리합니다.
    if (value === null || value === undefined) {
        return '';
    }

    // 문자열로 바꾼 뒤 앞뒤 공백을 제거합니다.
    return String(value).trim();
}

function parseRandomCsv(value, maxItems = 80) {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    const seen = new Set();
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
            if (seen.has(item)) return false;
            seen.add(item);
            return true;
        })
        .slice(0, maxItems);
}

function parseRandomIdCsv(value, maxItems = 80) {
    return parseRandomCsv(value, maxItems)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >0);
}


// 2. 채점용 정규화 함수
// 실기 문제는 용어형, SQL형, 코드 출력형이 섞여 있습니다.
// 그래서 정답 비교 함수를 여러 개로 나눈다.


function normalizeFlexible(value) {
    // 일반 용어형 정답 채점에 사용합니다.
    // 예: Agile, agile, AGILE을 같은 답으로 보기 위한 처리입니다.
    // 현재 규칙:
    // 기존에는 쉼표(,) 같은 구분자를 너무 엄격하게 봐서
    // "Authentication, authorization Accounting"처럼 쉼표 하나가 빠진 답안이
    // 실제 용어가 포함되어도 낮은 점수를 받는 문제를 보완합니다.
    // 그래서 용어형 채점에서는 공백/쉼표/하이픈/대부분의 문장부호를 완화합니다.
    // 단, SQL_TEXT와 EXACT_OUTPUT은 별도 함수로 채점하므로 이 완화 규칙의 영향을 받지 않습니다.
    let text = cleanText(value);

    // CSV에 문자 그대로 들어간 \n을 실제 줄바꿈처럼 통일합니다.
    text = text.replace(/\\n/g, '\n');

    // 줄바꿈 형식을 통일합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 유니코드 표현 차이를 줄입니다.
    text = text.normalize('NFKC');

    // 영어 대소문자를 무시하기 위해 소문자로 변환합니다.
    text = text.toLowerCase();

    // 따옴표류는 용어형 채점에서 큰 의미가 없으므로 제거합니다.
    text = text.replace(/[“”‘’\"']/g, '');

    // 용어형에서는 대부분의 문장부호를 제거합니다.
    // 예: Cause-Effect Graph, Cause Effect Graph, Cause.effect graph를 같은 답으로 보기 위한 처리입니다.
    // 주의: 이 함수는 SQL이나 코드 출력 채점에는 사용하지 않습니다.
    text = text.replace(/[.,。·!?:;，、_\-—–\/\\()[\]{}<>|]/g, '');

    // 공백과 줄바꿈을 제거합니다.
    text = text.replace(/\s+/g, '');

    return text.trim();
}

const ORDERED_LABEL_PATTERN = /^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|(?:\(?\d{1,2}\)?(?:[.)、:：]|\s+)))\s*/u;
const SAFE_SINGLE_SYMBOL_ALIASES = new Set(['-', '+', '*', '/', '\\', '=', '<', '>', '∪', '∩', '×', 'π', 'σ', '⋈']);

function stripLeadingOrderLabel(value) {
    const text = cleanText(value);
    if (!text) return '';

    const rawStripped = text.replace(ORDERED_LABEL_PATTERN, '').trim();
    if (rawStripped !== text) {
        return rawStripped;
    }

    // NFKC turns ① into 1, so run the same label removal once more after normalization.
    return text.normalize('NFKC').replace(ORDERED_LABEL_PATTERN, '').trim();
}

function normalizeSymbolicFlexible(value) {
    // 기호형 답안용 비교값입니다.
    // 일반 normalizeFlexible은 (), [], {}, -, <, > 같은 문장부호를 지우므로
    // 자료사전 기호, 관계대수 기호, UML 스테레오 타입처럼 기호 자체가 정답인 문제는
    // 이 함수로 기호를 보존한 비교값도 함께 만듭니다.
    let text = cleanText(value);

    text = text.replace(/\\n/g, '\n');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.normalize('NFKC').toLowerCase();
    text = text.replace(/[“”‘’\"'`]/g, '');
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



function normalizeExactOutput(value) {
    // 코드 출력 문제에 사용합니다.
    // 출력 문제는 대소문자, 공백, 줄바꿈이 중요하므로 최대한 보존합니다.
    let text = cleanText(value);

    // 문자 그대로의 \n을 실제 줄바꿈으로 변환합니다.
    text = text.replace(/\\n/g, '\n');

    // 줄바꿈 형식만 통일합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 앞뒤 공백만 제거합니다.
    return text.trim();
}


function normalizeSql(value) {
    // SQL 문제에 사용합니다.
    // SQL은 대소문자와 여러 칸 공백은 크게 중요하지 않게 보되,
    // SELECT, WHERE, 괄호, 비교연산자 같은 문법 기호는 보존합니다.
    let text = cleanText(value);

    // 줄바꿈을 공백으로 변환합니다.
    text = text.replace(/\\n/g, ' ');
    text = text.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');

    // 유니코드 표현 차이를 줄입니다.
    text = text.normalize('NFKC');

    // 영어 대소문자를 무시합니다.
    text = text.toLowerCase();

    // SQL 마지막 세미콜론은 써도 되고 안 써도 되게 처리합니다.
    text = text.replace(/;$/g, '');

    // 쉼표와 괄호 주변 공백 차이를 줄입니다.
    text = text.replace(/\s*,\s*/g, ',');
    text = text.replace(/\s*\(\s*/g, '(');
    text = text.replace(/\s*\)\s*/g, ')');

    // 여러 공백을 하나로 줄입니다.
    text = text.replace(/\s+/g, ' ');

    return text.trim();
}


// 3. JSON 안전 파싱 함수


function safeJsonParse(value, fallback) {
    try {
        if (Array.isArray(value) || typeof value === 'object') {
            return value || fallback;
        }

        if (!value) {
            return fallback;
        }

        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}


// 4. 정답 슬롯 분리 함수
// MULTI_TERM 문제에서 사용자 답안을 쉼표 또는 줄바꿈 기준으로 나눈다.
// 예: "원자성, 독립성" 또는 "원자성\n독립성"
function splitUserSlots(userAnswer) {
    // 사용자가 쉼표나 줄바꿈으로 답을 나누어 입력한 경우를 위한 보조 함수입니다.
    // 다만 현재 동작 기준으로는 쉼표가 빠진 답안도 최대한 인정하기 위해
    // calculateMultiTermScore에서 "전체 답안에 용어가 포함되어 있는지"도 함께 확인합니다.
    const raw = cleanText(userAnswer);

    if (!raw) {
        return [];
    }

    return raw
        .replace(/\\n/g, '\n')
        .split(/,|\n|\/|;|\|/)
        .flatMap(item => buildComparableVariants(item))
        .filter(item => item !== '');
}


function isSafeSingleSymbolAlias(value) {
    return SAFE_SINGLE_SYMBOL_ALIASES.has(cleanText(value));
}


function isAliasMatchedByUser(alias, userSlots, normalizedWholeUserAnswerVariants) {
    // 정답 별칭 하나가 사용자의 답안에 들어있는지 확인합니다.
    const normalizedAliases = buildComparableVariants(alias);
    const wholeVariants = Array.isArray(normalizedWholeUserAnswerVariants)
        ? normalizedWholeUserAnswerVariants
        : [normalizedWholeUserAnswerVariants].filter(Boolean);

    if (normalizedAliases.length === 0) {
        return false;
    }

    for (const normalizedAlias of normalizedAliases) {
        if (!normalizedAlias) {
            continue;
        }

        // 1글자짜리 별칭은 전체 문자열 포함으로 보면 오탐 가능성이 높습니다.
    // 예: C, O 같은 답은 반드시 분리된 슬롯과 정확히 일치할 때만 인정합니다.
        if (normalizedAlias.length <= 1 && !isSafeSingleSymbolAlias(normalizedAlias)) {
            if (userSlots.includes(normalizedAlias)) {
                return true;
            }
            continue;
        }

        // 1순위: 쉼표/줄바꿈 등으로 나뉜 슬롯 중 정확히 일치하는지 확인합니다.
        if (userSlots.includes(normalizedAlias)) {
            return true;
        }

        // 2순위: 사용자가 쉼표를 빼먹었더라도 전체 답안 안에 해당 용어가 들어있으면 인정합니다.
        // 예: "Authentication, authorization Accounting" 안에는
        // authentication / authorization / accounting이 모두 들어있으므로 3개 모두 인정합니다.
        if (wholeVariants.some(whole => whole.includes(normalizedAlias))) {
            return true;
        }
    }

    return false;
}


function shouldSplitAnswerByComma(answerRaw) {
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


function buildRuntimeAnswerAliases(rawAlias) {
    const raw = cleanText(rawAlias);
    const withoutOrderLabel = stripLeadingOrderLabel(raw);
    return uniqueNonEmpty([
        raw,
        withoutOrderLabel,
        ...buildComparableVariants(raw),
        ...buildComparableVariants(withoutOrderLabel),
    ]);
}


function buildRuntimeAnswerSlots(answerRaw) {
    const raw = cleanText(answerRaw);

    if (!raw) {
        return [];
    }

    const parts = shouldSplitAnswerByComma(raw) ? raw.split(',') : [raw];

    return parts
        .map(part => buildRuntimeAnswerAliases(part))
        .filter(slot => slot.length > 0);
}


function mergeAnswerSlots(primarySlots, secondarySlots) {
    if (!Array.isArray(primarySlots) || primarySlots.length === 0) {
        return Array.isArray(secondarySlots) ? secondarySlots : [];
    }

    if (!Array.isArray(secondarySlots) || secondarySlots.length === 0) {
        return primarySlots;
    }

    const slotCount = Math.max(primarySlots.length, secondarySlots.length);
    const merged = [];

    for (let index = 0; index < slotCount; index += 1) {
        const primary = primarySlots[index] || [];
        const secondary = secondarySlots[index] || [];
        merged.push(uniqueNonEmpty([
            ...(Array.isArray(primary) ? primary : [primary]),
            ...(Array.isArray(secondary) ? secondary : [secondary])
        ]));
    }

    return merged.filter(slot => slot.length > 0);
}


// 5. 부분점수 계산 함수
// 정보처리기사 실기 부분점수 기준을 초기 운영 기준에 맞춰 보수적으로 적용합니다.
// - 코드 출력형(EXACT_OUTPUT): 부분점수를 적용하지 않습니다.
// - SQL형(SQL_TEXT): 부분점수를 적용하지 않습니다.
// - 일반 용어형(FLEX_TERM): 부분점수를 적용하지 않습니다.
// - 여러 용어 답안형(MULTI_TERM):
//  2개 답안: 0 / 3 / 5
//  3개 답안: 0 / 1 / 3 / 5
//  그 외: 맞힌 비율 기반 단순 환산
// 현재 규칙:
// MULTI_TERM은 쉼표가 없어도 정답 용어가 답안 전체에 들어있으면 인정합니다.
// 그래서 "A, B C"처럼 구분자가 하나 빠진 경우에도 A/B/C를 각각 찾아낼 수 있습니다.


function calculateMultiTermScore(answerSlots, userAnswer) {
    const userSlots = splitUserSlots(userAnswer);
    const normalizedWholeUserAnswerVariants = buildComparableVariants(userAnswer);

    if (!Array.isArray(answerSlots) || answerSlots.length === 0) {
        return {
            isCorrect: false,
            score: 0,
            correctSlotCount: 0,
            totalSlotCount: 0,
            matchedSlots: []
        };
    }

    let correctSlotCount = 0;
    const matchedSlots = [];

    // 각 정답 슬롯마다 사용자의 답 중 하나라도 일치하거나,
    // 사용자의 전체 답안 안에 해당 용어가 포함되어 있으면 맞힌 것으로 본다.
    for (const slotAliases of answerSlots) {
        const aliases = Array.isArray(slotAliases) ? slotAliases : [slotAliases];

        const matchedAlias = aliases.find(alias => (
            isAliasMatchedByUser(alias, userSlots, normalizedWholeUserAnswerVariants)
        ));

        if (matchedAlias) {
            correctSlotCount += 1;
            matchedSlots.push(cleanText(matchedAlias));
        }
    }

    const totalSlotCount = answerSlots.length;
    let score = 0;

    if (correctSlotCount === totalSlotCount) {
        score = 5;
    } else if (totalSlotCount === 2) {
        // 2개 중 1개 맞으면 3점
        score = correctSlotCount === 1 ? 3 : 0;
    } else if (totalSlotCount === 3) {
        // 3개 중 1개 맞으면 1점, 2개 맞으면 3점
        if (correctSlotCount === 1) score = 1;
        else if (correctSlotCount === 2) score = 3;
        else score = 0;
    } else {
        // 그 외 개수는 비율 기반으로 보수적으로 계산합니다.
        score = Math.floor((correctSlotCount / totalSlotCount) * 5);
    }

    return {
        isCorrect: score === 5,
        score,
        correctSlotCount,
        totalSlotCount,
        matchedSlots
    };
}

module.exports = {
    cleanText,
    parseRandomCsv,
    parseRandomIdCsv,
    normalizeFlexible,
    normalizeExactOutput,
    normalizeSql,
    safeJsonParse,
    stripLeadingOrderLabel,
    uniqueNonEmpty,
    buildComparableVariants,
    buildRuntimeAnswerSlots,
    mergeAnswerSlots,
    calculateMultiTermScore,
};
