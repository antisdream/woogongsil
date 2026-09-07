'use strict';

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function collectBlockText(blocks) {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    const visit = (block) => {
        if (!block || typeof block !== 'object') return;
        if (typeof block.content === 'string') {
            parts.push(block.content);
        } else if (Array.isArray(block.content)) {
            block.content.forEach((item) => {
                if (typeof item === 'string') parts.push(item);
                else if (item && typeof item === 'object' && item.text) parts.push(item.text);
            });
        }
        if (block.type === 'image') {
            const caption = block.props?.caption || block.props?.name || '';
            if (caption) parts.push(caption);
        }
        if (Array.isArray(block.children)) block.children.forEach(visit);
    };
    blocks.forEach(visit);
    return parts.join(' ');
}

function buildDraftSummary(title, content, contentJson) {
    let baseText = String(content || '').trim();
    if (!baseText && contentJson) {
        baseText = collectBlockText(parseJsonArray(contentJson)).trim();
    }
    if (!baseText) baseText = String(title || '').trim();
    const summary = baseText.replace(/\s+/g, ' ').trim();
    return (summary || '내용 없음').slice(0, 220);
}

function normalizeDraftSaveReason(value) {
    const reason = String(value || '').trim().toLowerCase();
    return reason === 'exit' || reason === 'auto' ? 'exit' : 'manual';
}

module.exports = {
    buildDraftSummary,
    collectBlockText,
    normalizeDraftSaveReason,
    parseJsonArray,
};
