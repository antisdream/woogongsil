'use strict';

function normalizeBoardContentJson(value) {
    if (value === undefined || value === null) return null;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        JSON.parse(trimmed);
        return trimmed;
    }

    if (Array.isArray(value) || typeof value === 'object') {
        return JSON.stringify(value);
    }

    return null;
}

module.exports = {
    normalizeBoardContentJson,
};
