'use strict';

const RESULT_STORAGE_VERSION = 'RESULT_ONLY_V1';

function clonePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
}

function collectSensitiveStrings(value, output = []) {
    if (value === null || value === undefined) return output;
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) output.push(normalized);
        return output;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectSensitiveStrings(item, output));
        return output;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach((item) => collectSensitiveStrings(item, output));
    }
    return output;
}

function redactSensitiveStrings(value, sensitiveValues) {
    if (typeof value === 'string') {
        return sensitiveValues.reduce(
            (text, sensitive) => text.split(sensitive).join('이용자'),
            value
        );
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveStrings(item, sensitiveValues));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, redactSensitiveStrings(item, sensitiveValues)])
        );
    }
    return value;
}

function sanitizeFortuneResult(type, result, rawInput = {}) {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (normalizedType === 'individual') {
        const safeResult = {
            schemaVersion: RESULT_STORAGE_VERSION,
            type: 'individual',
            result: {
                saju: clonePlainObject(result?.saju),
                elementCount: clonePlainObject(result?.elementCount),
                yongsin: String(result?.yongsin || ''),
                mostElement: String(result?.mostElement || ''),
                gyeokguk: String(result?.gyeokguk || ''),
                todaySinsal: String(result?.todaySinsal || ''),
                score: Number(result?.score || 0),
                totalLuck: String(result?.totalLuck || ''),
                examLuck: String(result?.examLuck || ''),
                loveLuck: String(result?.loveLuck || ''),
            },
        };
        const sensitiveValues = [...new Set([
            String(result?.name || '').trim(),
            ...collectSensitiveStrings(rawInput),
        ].filter(Boolean).sort((a, b) => b.length - a.length))];
        return redactSensitiveStrings(safeResult, sensitiveValues);
    }

    if (normalizedType === 'couple') {
        const safeResult = {
            schemaVersion: RESULT_STORAGE_VERSION,
            type: 'couple',
            result: {
                first: {
                    saju: clonePlainObject(result?.p1?.saju),
                    elementCount: clonePlainObject(result?.p1?.elementCount),
                    yongsin: String(result?.p1?.yongsin || ''),
                },
                second: {
                    saju: clonePlainObject(result?.p2?.saju),
                    elementCount: clonePlainObject(result?.p2?.elementCount),
                    yongsin: String(result?.p2?.yongsin || ''),
                },
                score: Number(result?.score || 0),
                details: clonePlainObject(result?.details),
            },
        };
        const sensitiveValues = [...new Set([
            String(result?.p1?.name || '').trim(),
            String(result?.p2?.name || '').trim(),
            ...collectSensitiveStrings(rawInput),
        ].filter(Boolean).sort((a, b) => b.length - a.length))];
        return redactSensitiveStrings(safeResult, sensitiveValues);
    }

    throw new Error('지원하지 않는 운세 결과 유형입니다.');
}

module.exports = {
    RESULT_STORAGE_VERSION,
    sanitizeFortuneResult,
};
