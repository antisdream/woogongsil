import { createBlockNoteDocumentFromText, parseBoardContentJson } from '../board/boardUtils.js';

export const STUDY_SCOPE_MINE = 'mine';
export const STUDY_SCOPE_PUBLIC = 'public';
export const STUDY_ROOT_FOLDER = 'root';

export const getStudyAuthPayload = () => {
    const userId = sessionStorage.getItem('userId') || '';
    return {
        id: userId,
        userId,
        sessionToken: sessionStorage.getItem('sessionToken') || '',
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    };
};

export const isStudyLoggedIn = () => {
    const auth = getStudyAuthPayload();
    return Boolean(auth.userId && auth.sessionToken);
};

export const normalizeStudyFolderKey = (folderId) => {
    if (!folderId || folderId === STUDY_ROOT_FOLDER) return STUDY_ROOT_FOLDER;
    return String(folderId);
};

export const getStudyBlockText = (block) => {
    if (block?.type === 'image') {
        return block?.props?.caption || block?.props?.name || '';
    }

    const content = block?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((item) => {
            if (typeof item === 'string') return item;
            return item?.text || '';
        }).join('');
    }
    return '';
};

export const contentHasWrongNoteCommand = (content = '') => /(^|\n)\/오답노트\s*$/.test(String(content || ''));

export const flattenStudyFolders = (folders = []) => {
    const childrenByParent = new Map();
    folders.forEach((folder) => {
        const parentKey = normalizeStudyFolderKey(folder.parentId);
        const list = childrenByParent.get(parentKey) || [];
        list.push(folder);
        childrenByParent.set(parentKey, list);
    });

    const result = [];
    const visit = (parentKey, depth, seen = new Set()) => {
        const children = childrenByParent.get(parentKey) || [];
        children.forEach((folder) => {
            const key = String(folder.id);
            if (seen.has(key)) return;
            result.push({ ...folder, depth });
            visit(key, depth + 1, new Set([...seen, key]));
        });
    };

    visit(STUDY_ROOT_FOLDER, 0);
    return result;
};

export const getStudyDocumentBlocks = (content, contentJson) => (
    parseBoardContentJson(contentJson) || createBlockNoteDocumentFromText(content || '')
);

const clipText = (value, max = 900) => {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

const getImageNameFromUrl = (url = '') => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return '';

    try {
        const parsed = new URL(cleanUrl, window.location.origin);
        const fileName = parsed.pathname.split('/').filter(Boolean).pop() || '';
        return decodeURIComponent(fileName) || cleanUrl;
    } catch {
        const fileName = cleanUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
        return fileName || cleanUrl;
    }
};

const appendImageBlock = (blocks, imageUrl, caption) => {
    const cleanUrl = String(imageUrl || '').trim();
    if (!cleanUrl) return;

    blocks.push({
        type: 'image',
        props: {
            url: cleanUrl,
            caption,
            name: getImageNameFromUrl(cleanUrl),
            showPreview: true,
        },
    });
};

const getWrongSourceTitle = (wrong = {}) => (
    wrong.sourceTitle
    || wrong.source_title
    || (wrong.source === 'ipep_three_week' ? '실기 3주 공략 오답' : '')
    || wrong.sourceLabel
    || wrong.source
    || '오답'
);

const getWrongSourceDetail = (wrong = {}) => {
    const explicit = wrong.sourceDetail || wrong.source_detail || '';
    if (explicit) return explicit;

    if (wrong.source === 'ipep_three_week' || wrong.sourceType === 'ipep_three_week') {
        const week = wrong.weekNo || wrong.week_no || '?';
        const section = wrong.sectionNo || wrong.section_no || '---';
        const key = wrong.sectionQuestionKey || wrong.section_question_key || wrong.questionNo || wrong.question_id || '';
        return `실기 3주 공략 ${week}주차 Section ${section} ${key}`.trim();
    }

    return wrong.sourceLabel || wrong.source_label || getWrongSourceTitle(wrong);
};

export const buildWrongNoteBlocks = (wrongNotes = []) => {
    const blocks = [];

    wrongNotes.forEach((wrong, index) => {
        if (index > 0) blocks.push({ type: 'paragraph', content: '' });

        const sourceTitle = getWrongSourceTitle(wrong);
        const sourceDetail = getWrongSourceDetail(wrong);

        blocks.push(
            { type: 'paragraph', content: `오답노트: ${sourceTitle}` },
            { type: 'paragraph', content: `출처: ${sourceDetail}` },
            { type: 'paragraph', content: `문제: ${clipText(wrong.questionText)}` }
        );

        if (Array.isArray(wrong.options) && wrong.options.length > 0) {
            wrong.options.forEach((option) => {
                blocks.push({ type: 'paragraph', content: `보기 ${option.label}. ${clipText(option.text, 500)}` });
            });
        }

        blocks.push(
            { type: 'paragraph', content: `내 답: ${wrong.userAnswer || '기록 없음'}` },
            { type: 'paragraph', content: `정답: ${wrong.correctAnswer || '정답 정보 없음'}` }
        );

        if (wrong.explanation) {
            blocks.push({ type: 'paragraph', content: `해설: ${clipText(wrong.explanation, 1000)}` });
        }
        if (wrong.questionImage) {
            appendImageBlock(blocks, wrong.questionImage, '문제 이미지');
        }
        if (wrong.explanationImage) {
            appendImageBlock(blocks, wrong.explanationImage, '해설 이미지');
        }
        blocks.push({ type: 'paragraph', content: '내 정리: ' });
    });

    return blocks;
};

export const appendWrongNotesToStudyDocument = ({ content, contentJson, wrongNotes }) => {
    const baseBlocks = getStudyDocumentBlocks(content, contentJson)
        .filter((block) => getStudyBlockText(block).trim() !== '/오답노트');
    const nextBlocks = [
        ...baseBlocks,
        ...(baseBlocks.length ? [{ type: 'paragraph', content: '' }] : []),
        ...buildWrongNoteBlocks(wrongNotes),
    ];
    const nextContent = nextBlocks
        .map(getStudyBlockText)
        .join('\n')
        .replace(/(^|\n)\/오답노트\s*$/g, '')
        .trim();

    return {
        content: nextContent,
        contentJson: JSON.stringify(nextBlocks),
    };
};
