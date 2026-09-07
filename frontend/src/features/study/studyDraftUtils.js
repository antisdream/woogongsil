export const collectDraftBlockText = (blocks) => {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    const visit = (block) => {
        if (!block || typeof block !== 'object') return;
        if (typeof block.content === 'string') {
            parts.push(block.content);
        } else if (Array.isArray(block.content)) {
            block.content.forEach((item) => {
                if (typeof item === 'string') parts.push(item);
                else if (item?.text) parts.push(item.text);
            });
        }
        if (block.type === 'image') {
            const imageText = block.props?.caption || block.props?.name || block.props?.url || '';
            if (imageText) parts.push(imageText);
        }
        if (Array.isArray(block.children)) block.children.forEach(visit);
    };
    blocks.forEach(visit);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};

export const getDraftContentJsonText = (rawContentJson) => {
    if (!rawContentJson) return '';
    try {
        const parsed = typeof rawContentJson === 'string' ? JSON.parse(rawContentJson) : rawContentJson;
        return collectDraftBlockText(parsed);
    } catch {
        return '';
    }
};

export const hasDraftableContent = (state = {}) => {
    const title = String(state.title || '').trim();
    const body = String(state.content || '').trim();
    const jsonText = getDraftContentJsonText(state.contentJson);
    return Boolean(
        body ||
        jsonText ||
        (title && title !== '새 학습노트') ||
        (Array.isArray(state.wrongRefs) && state.wrongRefs.length > 0)
    );
};

export const buildDraftSignature = (state = {}) => JSON.stringify({
    id: state.id || null,
    folderId: state.folderId || null,
    title: String(state.title || '').trim(),
    content: state.content || '',
    contentJson: state.contentJson || '',
    visibility: state.visibility || 'private',
    docType: state.docType || 'note',
    wrongRefs: Array.isArray(state.wrongRefs) ? state.wrongRefs : [],
});

export const formatDraftNow = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};
