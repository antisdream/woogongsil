'use strict';
const {
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
} = require('./ipepAnswerGrading');

const { evaluateIpepAnswerAliases } = require('./ipepAnswerAliases');
function baseGrade(question, userAnswer, source) {
        const gradingPolicy = question.grading_policy || 'FLEX_TERM';
        const answerRaw = cleanText(question.answer_raw);
        const answerAliases = safeJsonParse(question.answer_aliases_json, []);
        const answerSlots = safeJsonParse(question.answer_slots_json, []);
        const runtimeAnswerSlots = buildRuntimeAnswerSlots(answerRaw);
        const effectiveAnswerSlots = source === 'ipep_three_week'
            ? mergeAnswerSlots(runtimeAnswerSlots, answerSlots)
            : answerSlots;

        let isCorrect = false;
        let score = 0;
        let normalizedUserAnswer = '';
        let normalizedCorrectAnswer = '';
        let detail = {};

        if (gradingPolicy === 'SELF_CHECK') {
            // 긴 서술형은 자동채점이 위험하므로 자기채점 안내를 반환합니다.
            return ({
                success: true,
                gradingPolicy,
                requiresSelfCheck: true,
                isCorrect: null,
                score: null,
                maxScore: question.score || 5,
                correctAnswer: answerRaw,
                explanationText: question.explanation_text || '',
                msg: '이 문제는 서술형 성격이 강해 정답 예시와 비교하는 자기채점 방식으로 확인해 주세요.'
            });
        }

        if (gradingPolicy === 'EXACT_OUTPUT') {
            normalizedUserAnswer = normalizeExactOutput(userAnswer);
            normalizedCorrectAnswer = normalizeExactOutput(answerRaw);
            isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: '대소문자, 공백, 줄바꿈을 최대한 정확히 비교'
            };
        } else if (gradingPolicy === 'SQL_TEXT') {
            normalizedUserAnswer = normalizeSql(userAnswer);
            normalizedCorrectAnswer = normalizeSql(answerRaw);
            isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: 'SQL 대소문자와 공백 차이는 완화, SQL 문법 기호는 보존'
            };
        } else if (gradingPolicy === 'MULTI_TERM') {
            const result = calculateMultiTermScore(effectiveAnswerSlots, userAnswer);

            isCorrect = result.isCorrect;
            score = result.score;

            detail = {
                compareMode: '여러 용어 답안: 쉼표/줄바꿈 누락, 순번 라벨 생략, 일부 기호형 답안까지 완화',
                correctSlotCount: result.correctSlotCount,
                totalSlotCount: result.totalSlotCount,
                matchedSlots: result.matchedSlots || []
            };
        } else {
            // FLEX_TERM 기본 처리합니다
            normalizedUserAnswer = normalizeFlexible(userAnswer);

            const normalizedAliases = uniqueNonEmpty([
                ...buildComparableVariants(answerRaw),
                ...buildComparableVariants(stripLeadingOrderLabel(answerRaw)),
                ...(Array.isArray(answerAliases) ? answerAliases.flatMap(alias => buildComparableVariants(alias)) : []),
            ]);
            const userAnswerVariants = buildComparableVariants(userAnswer);

            normalizedCorrectAnswer = normalizedAliases[0] || '';
            isCorrect = normalizedAliases.length >0 && userAnswerVariants.some(variant => normalizedAliases.includes(variant));
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: '일반 용어형: 대소문자, 공백, 쉼표, 하이픈 등 문장부호 완화, 기호형 답안은 별도 보존 비교'
            };
        }

        return ({
            success: true,
            gradingPolicy,
            requiresSelfCheck: false,
            isCorrect,
            score,
            maxScore: question.score || 5,
            correctAnswer: answerRaw,
            explanationText: question.explanation_text || '',
            normalizedUserAnswer,
            normalizedCorrectAnswer,
            detail
        });
}

function gradeIpepQuestion(question, userAnswer, source) {
    const result = baseGrade(question, String(userAnswer || '').trim(), source);
    const maxScore = Math.max(1, Math.min(100, Number(question.score) || 5));
    if (result.requiresSelfCheck) return { ...result, score: 0, maxScore, isCorrect: null, verified: false };
    result.score = Math.round(Math.max(0, Math.min(5, Number(result.score) || 0)) / 5 * maxScore * 100) / 100;
    result.maxScore = maxScore;
    // Flexible aliases must not relax exact-output/SQL or self-check policies.
    if (['FLEX_TERM', 'MULTI_TERM'].includes(result.gradingPolicy) && !result.score) {
        const alias = evaluateIpepAnswerAliases({ question, responseData: result, userAnswer });
        if (alias.canEvaluate && alias.isCorrect) {
            result.isCorrect = true;
            result.score = maxScore;
            result.detail = { ...result.detail, compareMode: 'SERVER_ALIAS' };
        }
    }
    return { ...result, verified: true };
}
module.exports = { gradeIpepQuestion };
