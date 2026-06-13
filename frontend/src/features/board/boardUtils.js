// Frontend feature module for boardUtils.
export const BOARD_NOTICE = 'notice';
export const BOARD_FREE = 'free';
export const BOARD_MARKER_NOTICE = '[[UGONGSIL_BOARD:NOTICE]]';
export const BOARD_MARKER_FREE = '[[UGONGSIL_BOARD:FREE]]';
export const BOARD_MARKER_REGEX = /\n?\[\[UGONGSIL_BOARD:(NOTICE|FREE)\]\]\s*$/;

export const normalizeBoardTab = (value) => (value === BOARD_FREE ? BOARD_FREE : BOARD_NOTICE);

export const parseBoardRoute = (wildcardPath = '') => {
    const parts = String(wildcardPath || '').split('/').filter(Boolean);
    const first = parts[0] || BOARD_NOTICE;

    if (first === BOARD_FREE || first === BOARD_NOTICE) {
        if (parts[1] === 'write') return { boardTab: first, view: 'write' };
        return { boardTab: first, view: 'list' };
    }

    if (first === 'write') return { boardTab: BOARD_NOTICE, view: 'write' };
    if (first === 'post' && parts[1]) return { boardTab: BOARD_NOTICE, view: 'detail', postId: parts[1] };
    if (first === 'my-posts') return { boardTab: BOARD_NOTICE, view: 'myActivity', activityTab: 'posts', protected: true };
    if (first === 'my-comments') return { boardTab: BOARD_NOTICE, view: 'myActivity', activityTab: 'comments', protected: true };

    return { boardTab: BOARD_NOTICE, view: 'list' };
};

export const getBoardListPath = (targetTab) => `/board/${normalizeBoardTab(targetTab)}`;
export const getBoardWritePath = (targetTab) => `/board/${normalizeBoardTab(targetTab)}/write`;
export const getBoardPostPath = (postId) => `/board/post/${postId}`;
export const getBoardActivityPath = (targetActivityTab = 'posts') => targetActivityTab === 'comments'? '/board/my-comments' : '/board/my-posts';

export const formatDateForList = (dateString) => {
    try {
        const parts = dateString.split('. ');
        if (parts.length >= 3) {
            return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
        return dateString.split(' ')[0];
    } catch {
        return dateString;
    }
};

export const getCleanContent = (rawContent = '') => String(rawContent || '').replace(BOARD_MARKER_REGEX, '').trimEnd();
export const getCleanTitle = (rawTitle = '') => String(rawTitle || '').replace(/^\s*\[공지\]\s*/, '');

export const withBoardMarker = (rawContent, targetBoard) => {
    const clean = getCleanContent(rawContent);
    const marker = targetBoard === BOARD_FREE ? BOARD_MARKER_FREE : BOARD_MARKER_NOTICE;
    return `${clean}\n${marker}`;
};

export const getPostBoardType = (post) => {
    const rawBoard = String(post?.boardType || post?.boardKind || post?.board || post?.category || '').toLowerCase();
    if (['notice', 'official', 'admin'].includes(rawBoard)) return BOARD_NOTICE;
    if (['free', 'general'].includes(rawBoard)) return BOARD_FREE;

    const contentText = String(post?.content || '');
    if (contentText.includes(BOARD_MARKER_NOTICE)) return BOARD_NOTICE;
    if (contentText.includes(BOARD_MARKER_FREE)) return BOARD_FREE;

    const noticeFlag = post?.isNotice ?? post?.is_notice;
    if (noticeFlag === true || noticeFlag === 1 || noticeFlag === '1' || String(noticeFlag || '').toLowerCase() === 'true') return BOARD_NOTICE;
    if (post?.authorName === '관리자') return BOARD_NOTICE;

    return BOARD_FREE;
};

export const getBoardGuideText = (boardTab) => {
    if (boardTab === BOARD_NOTICE) {
        return '공지게시판은 우공실 공식 안내를 확인하는 공간입니다.';
    }
    return '자유게시판은 질문, 오류 제보, 학습 정보 공유, 개선 의견을 자유롭게 남길 수 있습니다.';
};
