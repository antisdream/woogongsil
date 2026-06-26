// 게시판 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useScreenSettings from '../useScreenSettings';
import BoardWriteView from '../features/board/BoardWriteView.jsx';
import BoardContentView from '../features/board/BoardContentView.jsx';
import '../features/board/boardPage.css';
import {
    BOARD_NOTICE,
    BOARD_FREE,
    parseBoardRoute,
    getBoardListPath,
    getBoardWritePath,
    getBoardPostPath,
    getBoardActivityPath,
    formatDateForList,
    getCleanContent,
    getCleanTitle,
    withBoardMarker,
    getPostBoardType,
    getBoardGuideText,
    isTruthySessionFlag,
    replaceSettingTokens,
    getBoardDraftsNewestFirst,
    saveBoardDraft,
    removeBoardDraftAtNewestIndex,
    clearBoardDrafts,
    getBoardContentTextForValidation,
} from '../features/board/boardUtils.js';

const API_BASE = "";

const Board = () => {
    const { getSetting } = useScreenSettings('board');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = useCallback((key, fallback, values = {}) => (
        replaceSettingTokens(t(key, fallback), values)
    ), [t]);

    const userId = sessionStorage.getItem('userId');
    const userName = sessionStorage.getItem('userName');
    const getSessionAuth = useCallback(() => ({
        id: sessionStorage.getItem('userId') || userId || '',
        userId: sessionStorage.getItem('userId') || userId || '',
        sessionToken: sessionStorage.getItem('sessionToken') || '',
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    }), [userId]);

    //  관리자 판별
    const isAdmin = (
        isTruthySessionFlag(sessionStorage.getItem('isPrimaryAdmin')) ||
        isTruthySessionFlag(sessionStorage.getItem('is_primary_admin'))
    );

    // - 기존 백엔드 API는 게시글의 게시판 소속값(boardType)을 따로 저장하지 않는 구조일 수 있습니다.
    // - 그래서 프론트에서 content 끝에 보이지 않는 식별 마커를 붙여 공지게시판/자유게시판 소속을 안정적으로 구분합니다.
    // - 화면에 보여줄 때는 getCleanContent()로 이 마커를 제거하므로 사용자는 볼 수 없습니다.
    const navigate = useNavigate();
    const location = useLocation();
    const routeParams = useParams();

    const routeSplat = routeParams['*'];
    const initialBoardRoute = parseBoardRoute(routeSplat);

    // 비로그인 사용자가 게시판 목록/공지글은 볼 수 있게 하되,
    // 일반 게시글 열람·글쓰기·댓글·추천처럼 계정 기록이 필요한 기능은 이 함수로 막습니다.
    const LOGIN_REQUIRED_MESSAGE = t('messages.login_required', '로그인이 필요한 서비스입니다.');
    const boardNoticeLabel = t('tabs.notice_label', '공지게시판');
    const boardFreeLabel = t('tabs.free_label', '자유게시판');
    const getBoardLabel = (boardType) => boardType === BOARD_NOTICE ? boardNoticeLabel : boardFreeLabel;
    const isLoggedIn = !!(userId && sessionStorage.getItem('sessionToken'));
    const requireLogin = () => {
        if (isLoggedIn) return true;
        toast.error(LOGIN_REQUIRED_MESSAGE);
        return false;
    };

    const [view, setView] = useState(initialBoardRoute.view); 

    // 처음 게시판에 들어오면 공지게시판을 먼저 보여줍니다.
    // - 비로그인 사용자는 공지게시판 목록/공지글만 확인할 수 있습니다.
    // - 자유게시판 탭은 로그인한 사용자만 들어갈 수 있습니다.
    const [boardTab, setBoardTab] = useState(initialBoardRoute.boardTab);

    const [posts, setPosts] = useState([]);
    const [currentPost, setCurrentPost] = useState(null);
    
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [contentJson, setContentJson] = useState('');
    const [editorKey, setEditorKey] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOrder, setSortOrder] = useState('desc'); 
    
    const [commentText, setCommentText] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [activityTab, setActivityTab] = useState(initialBoardRoute.activityTab || 'posts'); 
    const [checkedIds, setCheckedIds] = useState([]); 
    
    const [currentPage, setCurrentPage] = useState(1);
    const postsPerPage = 10;

    const [showLoadModal, setShowLoadModal] = useState(false);
    const [savedList, setSavedList] = useState([]);

    //   공지사항 관리용 상태
    const [noticeMode, setNoticeMode] = useState('none'); // 'none', 'register', 'unregister', 'move'
    const [selectedNoticeIds, setSelectedNoticeIds] = useState([]);

    // 관리자 공지 노출 순서 관리 상태
    // - 기존 공지 등록/해제 기능은 유지합니다.
    // - DB에서 확인된 최고관리자만 공지 순서 편집 모드에 들어갈 수 있습니다.
    // - noticeOrderIds 배열의 앞쪽에 있는 공지가 게시판 상단에서 먼저 노출됩니다.
    const [noticeOrderMode, setNoticeOrderMode] = useState(false);
    const [noticeOrderIds, setNoticeOrderIds] = useState([]);

    const tempStateRef = useRef({ title, content, contentJson });
    const skipNextDraftSaveRef = useRef(false);
    
    useEffect(() => {
        tempStateRef.current = { title, content, contentJson };
    }, [title, content, contentJson]);

    const loadEditorState = useCallback((nextTitle = '', nextContent = '', nextContentJson = '') => {
        setTitle(nextTitle || '');
        setContent(nextContent || '');
        setContentJson(nextContentJson || '');
        setEditorKey((key) => key + 1);
    }, []);

    const saveToLocalList = useCallback((draftTitle, draftContent, draftContentJson = '', rawOptions = {}) => {
        const options = typeof rawOptions === 'boolean' ? { isAuto: rawOptions } : (rawOptions || {});
        const isAuto = Boolean(options.isAuto);
        const saved = saveBoardDraft(draftTitle, draftContent, draftContentJson, {
            replaceLatest: options.replaceLatest !== false,
            source: isAuto ? 'auto' : 'manual',
        });
        if (!saved) return false;
        if (!options.silent) {
            if (!isAuto) toast.success(t('draft.manual_saved', '수동으로 임시저장되었습니다.'), { autoClose: 2000 });
            else toast.info(t('draft.auto_saved', '작성 중인 글을 임시저장했습니다.'), { autoClose: 1500 });
        }
        return true;
    }, [t]);

    const saveCurrentDraft = useCallback((options = {}) => {
        const { title: draftTitle, content: draftContent, contentJson: draftContentJson } = tempStateRef.current;
        return saveToLocalList(draftTitle, draftContent, draftContentJson, {
            isAuto: true,
            silent: true,
            replaceLatest: true,
            ...options,
        });
    }, [saveToLocalList]);

    useEffect(() => {
        const nextRoute = parseBoardRoute(routeSplat);

        if (nextRoute.protected && !isLoggedIn) {
            toast.error(LOGIN_REQUIRED_MESSAGE);
            navigate('/board/notice', { replace: true });
            return;
        }

        if (nextRoute.view !== view) setView(nextRoute.view);
        if (nextRoute.boardTab !== boardTab) setBoardTab(nextRoute.boardTab);
        if (nextRoute.activityTab && nextRoute.activityTab !== activityTab) setActivityTab(nextRoute.activityTab);
    }, [LOGIN_REQUIRED_MESSAGE, activityTab, boardTab, isLoggedIn, location.pathname, navigate, routeSplat, view]);

    useEffect(() => {
        // 게시판은 FAQ처럼 비로그인 사용자도 목록과 공지글을 확인할 수 있어야 합니다.
        // 따라서 현재 방식과 동일하게 로그인하지 않았다고 홈으로 돌려보내지 않고, 게시글 목록은 항상 불러옵니다.
        fetchPosts();

        // 임시저장 불러오기는 사용자가 글쓰기 화면의 불러오기 버튼을 직접 눌렀을 때만 열립니다.
        if (!userId) {
            // 로그아웃 상태에서는 자유게시판을 볼 수 없으므로 공지게시판으로 되돌립니다.
            setBoardTab(BOARD_NOTICE);
            setSavedList([]);
        }
    }, [boardTab, userId]);

    useEffect(() => {
        if (view !== 'write' && !isEditing) return;

        const autoSave = setInterval(() => {
            saveCurrentDraft({ isAuto: true, silent: true });
        }, 60000); 

        const handleBeforeUnload = () => {
            saveCurrentDraft({ isAuto: true, silent: true });
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            clearInterval(autoSave);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (skipNextDraftSaveRef.current) {
                skipNextDraftSaveRef.current = false;
                return;
            }
            saveCurrentDraft({ isAuto: true, silent: true });
        };
    }, [view, isEditing, saveCurrentDraft]);

    const handleManualSave = () => {
        // 임시저장은 사용자별 작성 기능이므로 로그인한 사용자만 허용합니다.
        if (!requireLogin()) return;
        if (!title.trim() && !content.trim()) return alert(t('draft.empty_save_alert', '저장할 내용이 없습니다.'));
        saveToLocalList(title, content, contentJson, { isAuto: false, silent: false, replaceLatest: true });
    };

    const openLoadModal = () => {
        // 불러오기는 로그인 사용자의 임시저장 목록에서만 사용합니다.
        if (!requireLogin()) return;
        setSavedList(getBoardDraftsNewestFirst());
        setShowLoadModal(true);
    };

    const loadSpecificSave = (saveItem) => {
        if(window.confirm(t('draft.load_confirm', '현재 작성 중인 내용이 덮어씌워집니다. 불러오시겠습니까?'))) {
            loadEditorState(saveItem.title, saveItem.content, saveItem.contentJson || '');
            setShowLoadModal(false);
        }
    };

    const handleDeleteDraft = (indexToDelete) => {
        if(!window.confirm(t('draft.delete_confirm', '정말 이 임시저장 글을 삭제하시겠습니까?'))) return;
        const newSavedList = removeBoardDraftAtNewestIndex(savedList, indexToDelete);
        setSavedList(newSavedList);
        toast.success(t('draft.delete_success', '임시저장한 글이 삭제되었습니다.'));
    };

    async function fetchPosts() {
        try {
            const res = await axios.get(`${API_BASE}/api/posts`);
            setPosts(res.data);
        } catch (err) { console.error("게시글 불러오기 실패", err); }
    };

    useEffect(() => {
        const nextRoute = parseBoardRoute(routeSplat);
        if (nextRoute.view !== 'detail' || !nextRoute.postId || posts.length === 0) return;

        const matchedPost = posts.find((post) => String(post.id) === String(nextRoute.postId));
        if (!matchedPost) return;

        const targetBoard = getPostBoardType(matchedPost);
        if (targetBoard !== boardTab) setBoardTab(targetBoard);
        if (!currentPost || String(currentPost.id) !== String(matchedPost.id)) {
            setCurrentPost(matchedPost);
        }
    }, [boardTab, currentPost, location.pathname, posts, routeSplat]);

    // 현재 탭 설명 문구를 화면에 표시합니다.
    const handleChangeBoardTab = (nextTab) => {
        if (nextTab === BOARD_FREE && !requireLogin()) return;
        setBoardTab(nextTab);
        navigate(getBoardListPath(nextTab));
        setView('list');
        setNoticeMode('none');
        setSelectedNoticeIds([]);
        setNoticeOrderMode(false);
        setNoticeOrderIds([]);
        setSearchTerm('');
        setCurrentPage(1);
    };

    const handleEditorChange = useCallback((nextContent, nextContentJson) => {
        setContent(nextContent || '');
        setContentJson(nextContentJson || '');
    }, []);

    const handleCommentChange = (e, isReply = false) => {
        const text = e.target.value;
        if (text.length >100) {
            alert(t('messages.comment_limit_exceeded', '작성 가능한 댓글 내용이 100자가 초과되었습니다.'));
            if (isReply) setReplyText(text.substring(0, 100));
            else setCommentText(text.substring(0, 100));
        } else {
            if (isReply) setReplyText(text);
            else setCommentText(text);
        }
    };

    const handleCreatePost = async (e) => {
        e.preventDefault();
        // 비로그인 사용자는 게시글 등록 불가
        if (!requireLogin()) return;

        // 공지게시판은 DB에서 확인된 최고관리자만 글을 등록할 수 있습니다.
        if (boardTab === BOARD_NOTICE && !isAdmin) {
            toast.error(t('messages.notice_write_admin_only', '공지게시판 글 등록은 관리자만 가능합니다.'));
            return;
        }

        if (!title.trim() || !getBoardContentTextForValidation(content)) return alert(t('messages.need_title_content', '제목과 내용을 모두 입력해주세요.'));
        try {
            // 핵심: 새 글은 현재 선택한 탭(boardTab)을 content 마커로 저장합니다.
            // - 최고관리자가 자유게시판에서 작성하면 FREE 마커가 붙으므로 공지게시판으로 자동 이동하지 않습니다.
            // - 최고관리자가 공지게시판에서 작성하면 NOTICE 마커가 붙으므로 공지 해제 후에도 공지게시판에 남습니다.
            const finalContent = withBoardMarker(content, boardTab);
            const res = await axios.post(`${API_BASE}/api/posts`, {
                ...getSessionAuth(),
                title: getCleanTitle(title),
                content: finalContent,
                contentJson,
                authorId: userId,
                authorName: userName,

                // 백엔드가 새 공지글 작성 여부를 안정적으로 판단할 수 있도록 현재 게시판 탭을 함께 보냅니다.
                // - 기존 content 숨김 마커 방식은 그대로 유지합니다.
                // - 이 값은 공지메일 발송 조건 판단에만 사용되며 게시글/댓글/추천 로직은 유지합니다.
                boardType: boardTab
            });
            if (res.data.success) {
                alert(t('messages.post_created', '게시글이 등록되었습니다.'));
                skipNextDraftSaveRef.current = true;
                clearBoardDrafts();
                loadEditorState('', '', '');
                fetchPosts(); navigate(getBoardListPath(boardTab)); setView('list'); setCurrentPage(1);
            }
        } catch (err) { alert(t('messages.create_failed', '등록 실패: 서버 에러')); }
    };

    const handleUpdatePost = async (e) => {
        e.preventDefault();
        // 비로그인 사용자는 게시글 수정 불가
        if (!requireLogin()) return;
        if (!title.trim() || !getBoardContentTextForValidation(content)) return alert(t('messages.need_title_content', '제목과 내용을 모두 입력해주세요.'));
        try {
            // 수정할 때는 현재 화면 탭이 아니라 "원래 글의 소속"을 유지합니다.
            // - 공지 등록/해제 또는 수정 때문에 게시판 탭이 바뀌는 것을 방지합니다.
            const originalBoard = getPostBoardType(currentPost) || boardTab;
            const finalContent = withBoardMarker(content, originalBoard);
            const res = await axios.put(`${API_BASE}/api/posts/${currentPost.id}`, {
                ...getSessionAuth(),
                userId,
                title: getCleanTitle(title),
                content: finalContent,
                contentJson
            });
            if (res.data.success) {
                alert(t('messages.post_updated', '게시글이 수정되었습니다.'));
                skipNextDraftSaveRef.current = true;
                clearBoardDrafts();
                setIsEditing(false); fetchPosts();
                setCurrentPost({ ...currentPost, title: getCleanTitle(title), content: finalContent, contentJson });
                navigate(getBoardPostPath(currentPost.id));
                setView('detail');
            }
        } catch (err) { alert(err.response?.data?.msg || t('messages.update_failed', '수정 실패')); }
    };

    const handleCancelWrite = () => {
        const saved = saveCurrentDraft({ isAuto: true, silent: true });
        if (saved) toast.info(t('draft.left_saved', '작성 중인 글을 임시저장했습니다.'), { autoClose: 1500 });
        setIsEditing(false);
        setShowLoadModal(false);

        // Keep route and local view in sync so /board/.../write does not reopen the editor.
        if (isEditing && currentPost?.id) {
            navigate(getBoardPostPath(currentPost.id));
            setView('detail');
            return;
        }

        navigate(getBoardListPath(boardTab));
        setView('list');
    };

    const handleDeletePost = async (postId) => {
        // 비로그인 사용자는 게시글 삭제 불가
        if (!requireLogin()) return;
        if (!window.confirm(t('messages.post_delete_confirm', '정말 삭제를 진행하시겠습니까? 게시글을 삭제하면 복구를 할 수 없습니다.'))) return;
        try {
            const res = await axios.delete(`${API_BASE}/api/posts/${postId}`, { data: { ...getSessionAuth(), userId } });
            if (res.data.success) {
                alert(t('messages.delete_success', '삭제가 되었습니다.'));
                fetchPosts(); navigate(getBoardListPath(boardTab)); setView('list');
            }
        } catch (err) { alert(err.response?.data?.msg || t('messages.delete_forbidden', '삭제 권한이 없습니다.')); }
    };

    //   이메일 알림 전송 헬퍼 함수
    const sendNotificationEmail = async (type, targetUserId, targetUserName) => {
        if (targetUserId === userId) return; // 본인이 자신의 글에 반응할 때는 알림을 보내지 않음
        try {
            await axios.post(`${API_BASE}/api/posts/notify-email`, {
                ...getSessionAuth(),
                targetUserId,
                targetUserName,
                actionUserName: userName,
                type // 'like' 또는 'comment'
            });
        } catch (e) {
            console.error("알림 이메일 전송 실패:", e);
        }
    };

    const handleAddComment = async (e) => {
        e.preventDefault();
        // 비로그인 사용자는 댓글 등록 불가
        if (!requireLogin()) return;
        if (!commentText.trim()) return alert(t('messages.need_comment', '댓글을 입력해주세요.'));
        try {
            await axios.post(`${API_BASE}/api/posts/${currentPost.id}/comments`, { ...getSessionAuth(), text: commentText, authorId: userId, authorName: userName });
            setCommentText('');
            const res = await axios.get(`${API_BASE}/api/posts`);
            setPosts(res.data); setCurrentPost(res.data.find(p => p.id === currentPost.id));

            //   댓글 작성 시 원글 작성자에게 이메일 전송 요청
            if (currentPost.authorId !== userId) {
                sendNotificationEmail('comment', currentPost.authorId, currentPost.authorName);
            }
        } catch (err) { alert(t('messages.comment_create_failed', '댓글 등록 실패')); }
    };

    const handleAddReply = async (e, commentId) => {
        e.preventDefault();
        // 비로그인 사용자는 답글 등록 불가
        if (!requireLogin()) return;
        if (!replyText.trim()) return alert(t('messages.need_reply', '답글을 입력해주세요.'));
        try {
            await axios.post(`${API_BASE}/api/posts/${currentPost.id}/comments/${commentId}/replies`, { ...getSessionAuth(), text: replyText, authorId: userId, authorName: userName });
            setReplyText(''); setReplyingTo(null);
            const res = await axios.get(`${API_BASE}/api/posts`);
            setPosts(res.data); setCurrentPost(res.data.find(p => p.id === currentPost.id));

            //   대댓글 작성 시 원글 작성자에게 이메일 전송 요청
            if (currentPost.authorId !== userId) {
                sendNotificationEmail('comment', currentPost.authorId, currentPost.authorName);
            }
        } catch (err) { alert(t('messages.reply_create_failed', '답글 등록 실패')); }
    };

    const handleDeleteComment = async (commentId, hasReplies) => {
        // 비로그인 사용자는 댓글 삭제 불가
        if (!requireLogin()) return;
        if (hasReplies && !isAdmin) return alert(t('messages.comment_with_reply_delete_blocked', '대댓글이 달린 경우 삭제 할 수 없습니다.'));
        if (!window.confirm(t('messages.comment_delete_confirm', '정말 삭제를 진행하시겠습니까? 댓글을 삭제 하면 복구를 할 수 없습니다.'))) return;
        try {
            const res = await axios.delete(`${API_BASE}/api/posts/${currentPost.id}/comments/${commentId}`, { data: { ...getSessionAuth(), userId } });
            if (res.data.success) {
                alert(t('messages.delete_success', '삭제가 되었습니다.'));
                const updated = await axios.get(`${API_BASE}/api/posts`);
                setPosts(updated.data); setCurrentPost(updated.data.find(p => p.id === currentPost.id));
            }
        } catch (err) { alert(err.response?.data?.msg || t('messages.delete_forbidden', '삭제 권한이 없습니다.')); }
    };

    const handleViewPost = async (post) => {
        // 공지게시판 글은 누구나 열람 가능, 자유게시판 글은 로그인 사용자만 열람 가능
        const targetBoard = getPostBoardType(post);
        if (targetBoard === BOARD_FREE && !requireLogin()) return;

        try {
            await axios.post(`${API_BASE}/api/posts/${post.id}/view`);
            fetchPosts();
            // 상세 화면으로 들어갈 때도 해당 글의 실제 소속 탭을 맞춰둡니다.
            setBoardTab(targetBoard);
            setCurrentPost({ ...post, views: (post.views || 0) + 1 });
        } catch (e) {
            setBoardTab(targetBoard);
            setCurrentPost(post);
        } 
        finally {
            navigate(getBoardPostPath(post.id));
            setView('detail'); setIsEditing(false); setReplyingTo(null);
            setReplyText(''); setCommentText(''); window.scrollTo(0, 0); 
        }
    };

    const handleToggleLike = async () => {
        // 추천은 사용자별 중복 처리가 필요하므로 로그인한 사용자만 허용합니다
        if (!requireLogin()) return;
        try {
            const res = await axios.post(`${API_BASE}/api/posts/${currentPost.id}/like`, { ...getSessionAuth(), userId });
            if(res.data.success) {
                const isNowLiked = res.data.likedUsers.includes(userId);
                setCurrentPost({...currentPost, likes: res.data.likes, likedUsers: res.data.likedUsers});
                fetchPosts(); 
                
                //   좋아요를 새로 눌렀을 때만 알림을 전송하고, 취소 시에는 전송하지 않습니다.
                if (isNowLiked && currentPost.authorId !== userId) {
                    sendNotificationEmail('like', currentPost.authorId, currentPost.authorName);
                }
            }
        } catch(err) { alert(t('messages.like_failed', '추천 처리 실패')); }
    }

    const handleNoticeRegister = async () => {
        if (noticeMode === 'register') {
            if (selectedNoticeIds.length === 0) { toast.error(t('messages.no_selected_posts', '선택된 게시글이 없습니다.')); setNoticeMode('none'); return; }
            if (window.confirm(t('admin.notice_register_confirm', '체크한 게시글을 공지사항으로 등록하시겠습니까?'))) {
                try {
                    await axios.put(`${API_BASE}/api/posts/notice`, { ...getSessionAuth(), userId, postIds: selectedNoticeIds, isNotice: true });
                    toast.success(t('admin.notice_register_success', '공지사항을 등록하였습니다.'));
                    fetchPosts(); setNoticeMode('none'); setSelectedNoticeIds([]);
                } catch (e) { toast.error(t('admin.notice_register_failed', '공지사항 등록 오류')); }
            }
        } else {
            // 공지 등록 모드와 공지 순서 편집 모드가 동시에 켜지지 않게 분리합니다.
            setNoticeOrderMode(false);
            setNoticeOrderIds([]);
            setNoticeMode('register'); setSelectedNoticeIds([]);
            toast.info(t('admin.notice_register_instruction', "공지로 등록할 게시물을 체크한 뒤 '공지 등록' 버튼을 다시 눌러주세요."));
        }
    };

    const handleNoticeUnregister = async () => {
        if (noticeMode === 'unregister') {
            if (selectedNoticeIds.length === 0) { toast.error(t('messages.no_selected_posts', '선택된 게시글이 없습니다.')); setNoticeMode('none'); return; }
            if (window.confirm(t('admin.notice_unregister_confirm', '체크한 게시글의 공지를 해제하시겠습니까?'))) {
                try {
                    await axios.put(`${API_BASE}/api/posts/notice`, { ...getSessionAuth(), userId, postIds: selectedNoticeIds, isNotice: false });
                    toast.success(t('admin.notice_unregister_success', '공지사항이 해제 되었습니다.'));
                    fetchPosts(); setNoticeMode('none'); setSelectedNoticeIds([]);
                } catch (e) { toast.error(t('admin.notice_unregister_failed', '공지 해제 오류')); }
            }
        } else {
            // 공지 해제 모드와 공지 순서 편집 모드가 동시에 켜지지 않게 분리합니다.
            setNoticeOrderMode(false);
            setNoticeOrderIds([]);
            setNoticeMode('unregister'); setSelectedNoticeIds([]);
            toast.info(t('admin.notice_unregister_instruction', "공지를 해제할 게시물을 체크한 뒤 '공지 해제' 버튼을 다시 눌러주세요."));
        }
    };

    const toggleNoticeCheckbox = (id) => {
        setSelectedNoticeIds(prev => prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]);
    };

    // 공지 정렬값을 안전하게 숫자로 변환합니다.
    // - DB에 noticeOrder가 없는 기존 공지글은 매우 큰 값으로 두고, 같은 값이면 최신 글 순으로 정렬합니다.
    const getNoticeOrderValue = (post) => {
        const order = Number(post?.noticeOrder);
        return Number.isFinite(order) && order >0 ? order : Number.MAX_SAFE_INTEGER;
    };

    // 공지끼리 비교할 때 사용하는 정렬 함수입니다.
    // - noticeOrder가 작을수록 상단에 표시됩니다.
    // - noticeOrder가 없는 기존 데이터는 작성 시점이 최신인 공지가 위로 오게 보정합니다.
    const compareNoticePosts = (a, b) => {
        const orderA = getNoticeOrderValue(a);
        const orderB = getNoticeOrderValue(b);
        if (orderA !== orderB) return orderA - orderB;

        const idA = Number(a?.id) || 0;
        const idB = Number(b?.id) || 0;
        return idB - idA;
    };

    // 공지 순서 편집 모드를 켜거나, 편집된 순서를 서버에 저장합니다.
    const handleNoticeOrderToggle = async () => {
        if (!isAdmin) return;

        if (!noticeOrderMode) {
            const currentNotices = posts.filter(post => getPostBoardType(post) === boardTab && post.isNotice).sort(compareNoticePosts);
            if (currentNotices.length === 0) {
                toast.info(t('admin.notice_order_empty', '순서를 정리할 공지글이 없습니다.'));
                return;
            }

            // 공지 순서 편집 모드와 등록/해제 모드가 동시에 켜지지 않도록 초기화합니다.
            setNoticeMode('none');
            setSelectedNoticeIds([]);
            setNoticeOrderIds(currentNotices.map(post => post.id));
            setNoticeOrderMode(true);
            toast.info(t('admin.notice_order_instruction', '위/아래 버튼으로 공지 순서를 정리한 뒤 순서 저장을 눌러주세요.'));
            return;
        }

        if (!window.confirm(t('admin.notice_order_save_confirm', '현재 공지 노출 순서를 저장하시겠습니까?'))) return;

        try {
            await axios.put(`${API_BASE}/api/posts/notice-order`, {
                ...getSessionAuth(),
                userId,
                orderedPostIds: noticeOrderIds
            });
            toast.success(t('admin.notice_order_save_success', '공지 순서가 저장되었습니다.'));
            setNoticeOrderMode(false);
            setNoticeOrderIds([]);
            fetchPosts();
        } catch (e) {
            toast.error(e.response?.data?.msg || t('admin.notice_order_save_failed', '공지 순서 저장 중 오류가 발생했습니다.'));
        }
    };

    // 공지 순서 편집 모드에서 특정 공지를 한 칸 위/아래로 이동합니다.
    const moveNoticeItem = (postId, direction) => {
        setNoticeOrderIds(prev => {
            const currentIndex = prev.indexOf(postId);
            const nextIndex = currentIndex + direction;
            if (currentIndex < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;

            const next = [...prev];
            [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
            return next;
        });
    };

    // 관리자 전용 게시판 이동 기능
    // - 공지 등록/해제는 상단 강조 여부만 바꾸고, 게시판 소속은 바꾸지 않습니다.
    // - 정말 소속을 바꿔야 할 때만 최고관리자가 이 기능으로 이동시킵니다.
    // - 이동은 content 마커만 교체하므로 댓글/추천/조회수/작성자 정보는 그대로 유지됩니다.
    const handleBoardMoveToggle = async () => {
        if (!isAdmin) return;

        const targetBoard = boardTab === BOARD_NOTICE ? BOARD_FREE : BOARD_NOTICE;
        const targetLabel = getBoardLabel(targetBoard);

        if (noticeMode === 'move') {
            if (selectedNoticeIds.length === 0) {
                toast.error(t('admin.move_no_selected', '이동할 게시글을 선택해주세요.'));
                setNoticeMode('none');
                return;
            }

            if (!window.confirm(formatSetting('admin.move_confirm', '선택한 게시글을 {target}으로 이동하시겠습니까?', { target: targetLabel }))) return;

            try {
                const selectedPosts = posts.filter(post => selectedNoticeIds.includes(post.id));
                for (const post of selectedPosts) {
                    await axios.put(`${API_BASE}/api/posts/${post.id}`, {
                        ...getSessionAuth(),
                        userId,
                        title: getCleanTitle(post.title),
                        content: withBoardMarker(post.content, targetBoard)
                    });
                }
                toast.success(formatSetting('admin.move_success', '{target}으로 이동했습니다.', { target: targetLabel }));
                setNoticeMode('none');
                setSelectedNoticeIds([]);
                fetchPosts();
                setCurrentPage(1);
            } catch (e) {
                toast.error(e.response?.data?.msg || t('admin.move_failed', '게시판 이동 중 오류가 발생했습니다.'));
            }
            return;
        }

        setNoticeOrderMode(false);
        setNoticeOrderIds([]);
        setNoticeMode('move');
        setSelectedNoticeIds([]);
        toast.info(formatSetting('admin.move_instruction', "이동할 게시글을 체크한 뒤 '{target}으로 이동' 버튼을 다시 눌러주세요.", { target: targetLabel }));
    };

    const myPosts = posts.filter(p => p.authorId === userId);
    const myComments = [];
    posts.forEach(post => {
        post.comments.forEach(c => {
            if (c.authorId === userId && !c.text.includes("삭제한 댓글입니다.")) {
                myComments.push({ uniqueId: `c_${c.id}`, type: 'comment', postId: post.id, postTitle: getCleanTitle(post.title), commentId: c.id, text: c.text, date: c.date, hasReplies: c.replies && c.replies.length >0 });
            }
            if (c.replies) {
                c.replies.forEach(r => {
                    if (r.authorId === userId && !r.text.includes("삭제한 답글입니다.")) {
                        myComments.push({ uniqueId: `r_${r.id}`, type: 'reply', postId: post.id, postTitle: getCleanTitle(post.title), commentId: c.id, replyId: r.id, text: r.text, date: r.date, hasReplies: false });
                    }
                });
            }
        });
    });

    const goToPostById = (postId) => {
        const post = posts.find(p => p.id === postId);
        if (post) {
            // 내 활동에서 글로 이동할 때도 해당 글의 실제 게시판 탭을 맞춥니다.
            setBoardTab(getPostBoardType(post));
            handleViewPost(post);
        }
    };

    const handleSelectAll = (currentItems) => {
        if (checkedIds.length === currentItems.length && currentItems.length >0) setCheckedIds([]);
        else setCheckedIds(currentItems.map(item => item.uniqueId || item.id));
    };

    const toggleCheck = (id) => {
        if (checkedIds.includes(id)) setCheckedIds(checkedIds.filter(i => i !== id));
        else setCheckedIds([...checkedIds, id]);
    };

    const handleDeleteSelectedActivity = async () => {
        // 내 활동 삭제는 로그인 사용자 전용
        if (!requireLogin()) return;
        if (checkedIds.length === 0) return alert(t('activity.delete_empty_alert', '삭제할 항목을 선택해주세요.'));
        if (activityTab === 'posts') {
            if (window.confirm(t('activity.delete_confirm', '정말 삭제를 진행하시겠습니까?'))) {
                try {
                    for (let id of checkedIds) { await axios.delete(`${API_BASE}/api/posts/${id}`, { data: { ...getSessionAuth(), userId } }); }
                    alert(t('messages.delete_success', '삭제가 되었습니다.')); setCheckedIds([]); fetchPosts();
                } catch(err) { alert(t('activity.delete_posts_failed', '일부 게시글 삭제 실패')); }
            }
        } else {
            const itemsToDelete = myComments.filter(c => checkedIds.includes(c.uniqueId));
            if (itemsToDelete.some(c => c.hasReplies)) return alert(t('messages.comment_with_reply_delete_blocked', '대댓글이 달린 경우 삭제 할 수 없습니다.'));
            if (window.confirm(t('activity.delete_confirm', '정말 삭제를 진행하시겠습니까?'))) {
                try {
                    for (let item of itemsToDelete) {
                        if (item.type === 'comment') await axios.delete(`${API_BASE}/api/posts/${item.postId}/comments/${item.commentId}`, { data: { ...getSessionAuth(), userId } });
                        else await axios.delete(`${API_BASE}/api/posts/${item.postId}/comments/${item.commentId}/replies/${item.replyId}`, { data: { ...getSessionAuth(), userId } });
                    }
                    alert(t('messages.delete_success', '삭제가 되었습니다.')); setCheckedIds([]); fetchPosts();
                } catch(err) { alert(t('activity.delete_comments_failed', '일부 댓글 삭제 실패')); }
            }
        }
    };

    if (view === 'list') {
        // 현재 선택한 탭의 소속 글만 먼저 걸러냅니다.
        // - 공지 등록/해제는 isNotice만 바꾸므로 이 필터 결과에는 영향을 주지 않습니다.
        // - 따라서 공지게시판 글은 공지 해제 후에도 공지게시판에 남고,
        //  자유게시판 글은 공지 해제 후에도 자유게시판에 남습니다.
        const boardScopedPosts = posts.filter(post => getPostBoardType(post) === boardTab);

        const processedPosts = boardScopedPosts
            .filter(post => {
                const keyword = searchTerm.trim();
                if (!keyword) return true;
                return getCleanTitle(post.title).includes(keyword) || getCleanContent(post.content).includes(keyword);
            })
            .sort((a, b) => {
                // 공지 강조(isNotice)는 "해당 탭 안에서 위에 고정"하는 역할만 합니다.
                // 게시판 소속을 바꾸는 역할은 절대 하지 않습니다.
                if (a.isNotice && b.isNotice) return compareNoticePosts(a, b);
                if (a.isNotice !== b.isNotice) return a.isNotice ? -1 : 1;

                const timeA = parseInt(a.id); const timeB = parseInt(b.id);
                return sortOrder === 'desc'? timeB - timeA : timeA - timeB;
            });

        // 공지 순서 편집 모드에서는 현재 탭 안에서 공지로 등록된 글만 순서 조정합니다.
        const displayRows = noticeOrderMode
            ? noticeOrderIds.map(id => posts.find(post => post.id === id && getPostBoardType(post) === boardTab && post.isNotice)).filter(Boolean)
            : processedPosts;

        const totalPages = Math.ceil(displayRows.length / postsPerPage) || 1;
        const safeCurrentPage = Math.min(currentPage, totalPages);
        const idxLast = safeCurrentPage * postsPerPage;
        const idxFirst = idxLast - postsPerPage;
        const currentPosts = noticeOrderMode ? displayRows : displayRows.slice(idxFirst, idxLast);
        const pageTitle = formatSetting('list.page_title', ' {board}', { board: getBoardLabel(boardTab) });
        const targetMoveLabel = formatSetting('admin.move_button', '{target}으로 이동', { target: getBoardLabel(boardTab === BOARD_NOTICE ? BOARD_FREE : BOARD_NOTICE) });
        const boardGuideText = boardTab === BOARD_NOTICE
            ? t('guide.notice', getBoardGuideText(boardTab))
            : t('guide.free', getBoardGuideText(boardTab));

        return (
            <div className="board-page board-list-page wgs-typography-scope">
                <div className="board-topbar">
                    <div className="board-title-wrap">
                        <h2 className="board-page-title">{pageTitle}</h2>
                    </div>
                    <div className="board-action-row">
                        {isAdmin && (
                            <>
                                <button type="button" className={`board-button ${noticeMode === 'register' ? 'board-button-success' : 'board-button-warning'}`} onClick={handleNoticeRegister}>
                                    {noticeMode === 'register'? t('admin.notice_register_confirm_button', '등록 확인') : t('admin.notice_register_button', '공지 등록')}
                                </button>
                                <button type="button" className={`board-button ${noticeMode === 'unregister' ? 'board-button-success' : 'board-button-danger'}`} onClick={handleNoticeUnregister}>
                                    {noticeMode === 'unregister'? t('admin.notice_unregister_confirm_button', '해제 확인') : t('admin.notice_unregister_button', '공지 해제')}
                                </button>
                                <button type="button" className={`board-button ${noticeOrderMode ? 'board-button-success' : ''}`} onClick={handleNoticeOrderToggle}>
                                    {noticeOrderMode ? t('admin.notice_order_save_button', '순서 저장') : t('admin.notice_order_button', '공지 순서')}
                                </button>
                                <button type="button" className={`board-button ${noticeMode === 'move' ? 'board-button-success' : ''}`} onClick={handleBoardMoveToggle}>
                                    {targetMoveLabel}
                                </button>
                                {(noticeMode !== 'none' || noticeOrderMode) && (
                                    <button type="button" className="board-button" onClick={() => { setNoticeMode('none'); setSelectedNoticeIds([]); setNoticeOrderMode(false); setNoticeOrderIds([]); }}>{t('common.cancel', '취소')}</button>
                                )}
                            </>
                        )}
                        {(isAdmin || boardTab === BOARD_FREE) && (
                            <button type="button" className="board-button board-button-success" onClick={() => { if (!requireLogin()) return; setActivityTab('posts'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('posts')); setView('myActivity'); }}>{t('list.my_activity_button', '내가 작성한 글/댓글')}</button>
                        )}
                        {(isAdmin || boardTab === BOARD_FREE) && (
                            <button type="button" className="board-button board-button-primary" onClick={() => { if (!requireLogin()) return; if (boardTab === BOARD_NOTICE && !isAdmin) return toast.error(t('messages.notice_write_admin_only', '공지게시판 글 등록은 관리자만 가능합니다.')); loadEditorState('', '', ''); setIsEditing(false); navigate(getBoardWritePath(boardTab)); setView('write'); }}>{t('list.write_button', '게시글 등록')}</button>
                        )}
                    </div>
                </div>

                <div className="board-tab-grid">
                    <button type="button" className={`board-tab-button ${boardTab === BOARD_NOTICE ? 'is-active' : ''}`} onClick={() => handleChangeBoardTab(BOARD_NOTICE)}>{boardNoticeLabel}</button>
                    <button type="button" className={`board-tab-button ${boardTab === BOARD_FREE ? 'is-active' : ''}`} onClick={() => handleChangeBoardTab(BOARD_FREE)}>{boardFreeLabel}</button>
                </div>

                <p className="board-guide">{boardGuideText}</p>

                <div className="board-table-wrap table-wrapper">
                    <table className="board-table">
                        <thead>
                            <tr>
                                <th>{t('table.no_header', 'No')}</th>
                                <th>{t('table.title_header', '제목')}</th>
                                <th>{t('table.author_header', '작성자')}</th>
                                <th>{t('table.views_likes_header', '조회/추천')}</th>
                                <th>{t('table.date_header', '작성일')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentPosts.length >0 ? currentPosts.map((post, idx) => {
                                const displayNo = noticeOrderMode
                                    ? idx + 1
                                    : (sortOrder === 'desc'? displayRows.length - (idxFirst + idx) : idxFirst + idx + 1);
                                const totalComments = post.comments.reduce((acc, c) => acc + 1 + (c.replies ? c.replies.length : 0), 0);
                                const isSelectableMode = noticeMode !== 'none';
                                return (
                                    <tr key={post.id} className={`board-table-row ${post.isNotice ? 'is-notice' : ''}`}>
                                        <td>
                                            {noticeOrderMode ? (
                                                <div className="board-order-controls">
                                                    <button type="button" className="board-button" onClick={() => moveNoticeItem(post.id, -1)} disabled={idx === 0} title={t('admin.move_up_title', '위로 이동')}>{t('admin.move_up_button', '위')}</button>
                                                    <span>{idx + 1}</span>
                                                    <button type="button" className="board-button" onClick={() => moveNoticeItem(post.id, 1)} disabled={idx === currentPosts.length - 1} title={t('admin.move_down_title', '아래로 이동')}>{t('admin.move_down_button', '아래')}</button>
                                                </div>
                                            ) : isSelectableMode ? (
                                                <input type="checkbox" checked={selectedNoticeIds.includes(post.id)} onChange={() => toggleNoticeCheckbox(post.id)} />
                                            ) : post.isNotice ? t('table.notice_cell', '공지') : displayNo}
                                        </td>
                                        <td className="board-table-title" onClick={() => !isSelectableMode && !noticeOrderMode && handleViewPost(post)}>
                                            {post.isNotice && <span className="board-notice-badge">{t('table.notice_badge', '[공지]')}</span>}
                                            {getCleanTitle(post.title)} {totalComments >0 && <span className="board-count-badge">[{totalComments}]</span>}
                                        </td>
                                        <td className="board-subtle-text">{post.authorName}</td>
                                        <td className="board-subtle-text">{formatSetting('table.views_likes_value', '{views} / {likes}', { views: post.views || 0, likes: post.likes || 0 })}</td>
                                        <td className="board-subtle-text">{formatDateForList(post.date)}</td>
                                    </tr>
                                );
                            }) : ( <tr><td colSpan="5" className="board-subtle-text">{t('table.empty_posts', '게시글이 없습니다.')}</td></tr> )}
                        </tbody>
                    </table>
                </div>

                <div className="board-controls">
                    <select className="board-select" value={sortOrder} onChange={(e) => { setSortOrder(e.target.value); setCurrentPage(1); }}>
                        <option value="desc">{t('sort.desc_label', '최근 작성일 내림차순 정렬')}</option>
                        <option value="asc">{t('sort.asc_label', '최근 작성일 오름차순 정렬')}</option>
                    </select>
                    <input className="board-input" type="text" placeholder={t('search.placeholder', '제목 또는 내용 검색')} value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
                </div>

                <div className="board-pagination">
                    <button type="button" className="board-button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={noticeOrderMode || safeCurrentPage === 1}>{t('pagination.prev_button', '이전')}</button>
                    <span className="board-subtle-text">{noticeOrderMode ? 1 : safeCurrentPage} / {noticeOrderMode ? 1 : totalPages}</span>
                    <button type="button" className="board-button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={noticeOrderMode || safeCurrentPage === totalPages}>{t('pagination.next_button', '다음')}</button>
                </div>
            </div>
        );
    }

    if (view === 'myActivity') {
        const activeData = activityTab === 'posts'? myPosts : myComments;
        const totalPagesAct = Math.ceil(activeData.length / postsPerPage) || 1;
        const safeCurrentPageAct = Math.min(currentPage, totalPagesAct);
        const idxLast = safeCurrentPageAct * postsPerPage;
        const idxFirst = idxLast - postsPerPage;
        const currentItems = activeData.slice(idxFirst, idxLast);

        return (
            <div className="board-page board-my-page wgs-typography-scope">
                <div className="board-activity-toolbar">
                    <button type="button" className="board-button" onClick={() => { navigate(getBoardListPath(boardTab)); setView('list'); setCurrentPage(1); }}>{t('common.back_to_list', '목록으로')}</button>
                    <h2 className="board-page-title">{t('activity.title', '내가 작성한 활동')}</h2>
                </div>
                <div className="board-tab-grid">
                    <button type="button" className={`board-tab-button ${activityTab === 'posts' ? 'is-active' : ''}`} onClick={() => { setActivityTab('posts'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('posts')); }}>{formatSetting('activity.posts_tab', '내가 작성한 글 ({count})', { count: myPosts.length })}</button>
                    <button type="button" className={`board-tab-button ${activityTab === 'comments' ? 'is-active' : ''}`} onClick={() => { setActivityTab('comments'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('comments')); }}>{formatSetting('activity.comments_tab', '내가 작성한 댓글 ({count})', { count: myComments.length })}</button>
                </div>
                <div className="board-action-row">
                    <button type="button" className="board-button" onClick={() => handleSelectAll(currentItems)}>{t('activity.select_all_button', '전체선택')}</button>
                    <button type="button" className="board-button board-button-danger" onClick={handleDeleteSelectedActivity}>{t('activity.delete_selected_button', '선택 삭제')}</button>
                </div>
                <div className="board-table-wrap table-wrapper">
                    <table className="board-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>{activityTab === 'posts'? t('table.title_header', '제목') : t('activity.comment_table_header', '댓글 내용 / 원문 제목')}</th>
                                <th>{t('table.date_header', '작성일')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentItems.map((item) => {
                                const uniqueKey = item.uniqueId || item.id;
                                const isChecked = checkedIds.includes(uniqueKey);
                                return (
                                    <tr key={uniqueKey} className={`board-table-row ${isChecked ? 'is-selected' : ''}`}>
                                        <td>
                                            <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(uniqueKey)} />
                                        </td>
                                        <td className="board-table-title" onClick={() => goToPostById(item.postId || item.id)}>
                                            {activityTab === 'posts'? <span>{getCleanTitle(item.title)}</span> : <div><div>{item.text}</div><div className="board-original-title">{formatSetting('activity.original_title_label', '원본: {title}', { title: item.postTitle })}</div></div>}
                                        </td>
                                        <td className="board-subtle-text">{formatDateForList(item.date)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="board-pagination">
                    <button type="button" className="board-button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPageAct === 1}>{t('pagination.prev_button', '이전')}</button>
                    <span className="board-subtle-text">{safeCurrentPageAct} / {totalPagesAct}</span>
                    <button type="button" className="board-button" onClick={() => setCurrentPage(p => Math.min(totalPagesAct, p + 1))} disabled={safeCurrentPageAct === totalPagesAct}>{t('pagination.next_button', '다음')}</button>
                </div>
            </div>
        );
    }

    if (view === 'write') {
        return (
            <BoardWriteView
                t={t}
                formatSetting={formatSetting}
                isEditing={isEditing}
                boardTab={boardTab}
                getBoardLabel={getBoardLabel}
                title={title}
                content={content}
                contentJson={contentJson}
                editorKey={editorKey}
                uploadAuth={getSessionAuth()}
                uploadUrl={`${API_BASE}/api/posts/upload-file`}
                onTitleChange={(event) => setTitle(event.target.value)}
                onEditorChange={handleEditorChange}
                onCreatePost={handleCreatePost}
                onUpdatePost={handleUpdatePost}
                onCancelWrite={handleCancelWrite}
                onOpenLoadModal={openLoadModal}
                onManualSave={handleManualSave}
                showLoadModal={showLoadModal}
                savedList={savedList}
                onCloseLoadModal={() => setShowLoadModal(false)}
                onLoadDraft={loadSpecificSave}
                onDeleteDraft={handleDeleteDraft}
            />
        );
    }

    if (view === 'detail' && currentPost) {
        const totalComments = currentPost.comments.reduce((acc, c) => acc + 1 + (c.replies ? c.replies.length : 0), 0);
        return (
            <div className="board-page board-editor-page wgs-typography-scope">
                <div className="board-detail-toolbar">
                    <button type="button" className="board-button" onClick={() => { navigate(getBoardListPath(boardTab)); setView('list'); }}>{t('common.back_to_list', '목록으로')}</button>
                    <div className="board-inline-actions">
                        {(userId === currentPost.authorId || isAdmin) && (
                            <>
                                <button type="button" className="board-button board-button-success" onClick={() => { loadEditorState(getCleanTitle(currentPost.title), getCleanContent(currentPost.content), currentPost.contentJson || ''); setIsEditing(true); navigate(getBoardWritePath(getPostBoardType(currentPost))); setView('write'); }}>{t('common.edit', '수정')}</button>
                                <button type="button" className="board-button board-button-danger" onClick={() => handleDeletePost(currentPost.id)}>{t('common.delete', '삭제')}</button>
                            </>
                        )}
                    </div>
                </div>
                <h1 className="board-page-title">{currentPost.isNotice && t('detail.notice_prefix', '[공지] ')}{getCleanTitle(currentPost.title)}</h1>
                <div className="board-meta">{formatSetting('detail.meta_line', '작성자: {author} | 조회: {views} | 일시: {date}', { author: currentPost.authorName, views: currentPost.views, date: currentPost.date })}</div>
                <BoardContentView content={currentPost.content} contentJson={currentPost.contentJson} />
                <div className="board-like-row">
                    <button type="button" className={`board-button board-like-button ${currentPost.likedUsers?.includes(userId) ? 'is-liked' : ''}`} onClick={handleToggleLike}>{formatSetting('detail.like_button', '추천 {count}', { count: currentPost.likes || 0 })}</button>
                </div>
                <section className="board-comment-section">
                    <h3>{formatSetting('comments.title', '댓글 ({count})', { count: totalComments })}</h3>
                    <div className="board-comment-list">
                        {currentPost.comments.map(c => (
                            <article key={c.id} className="board-comment-item">
                                <div className="board-comment-head">{c.authorName} <span className="board-comment-date">{c.date}</span></div>
                                <div>{c.text}</div>
                                <div className="board-comment-actions">
                                    <button type="button" className="board-button-link" onClick={() => { if (!requireLogin()) return; setReplyingTo(replyingTo === c.id ? null : c.id); }}>{t('comments.reply_button', '답글')}</button>
                                    {(userId === c.authorId || isAdmin) && <button type="button" className="board-button-link board-button-danger" onClick={() => handleDeleteComment(c.id, c.replies?.length >0)}>{t('common.delete', '삭제')}</button>}
                                </div>
                                {replyingTo === c.id && (
                                    <form onSubmit={(e) => handleAddReply(e, c.id)} className="board-reply-form">
                                        <textarea className="board-textarea" value={replyText} readOnly={!isLoggedIn} placeholder={t('comments.reply_placeholder', '답글을 입력하세요')} onFocus={() => !isLoggedIn && requireLogin()} onChange={(e) => { if (!requireLogin()) return; handleCommentChange(e, true); }} />
                                        <button type="submit" className="board-button board-button-primary">{t('common.submit', '등록')}</button>
                                    </form>
                                )}
                                {c.replies?.length > 0 && (
                                    <div className="board-reply-list">
                                        {c.replies.map(r => (
                                            <article key={r.id} className="board-reply-item">
                                                <div className="board-comment-head">{r.authorName}</div>
                                                <div>{r.text}</div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                    <form onSubmit={handleAddComment} className="board-comment-form">
                        <textarea className="board-textarea" value={commentText} readOnly={!isLoggedIn} placeholder={t('comments.comment_placeholder', '댓글을 입력하세요')} onFocus={() => !isLoggedIn && requireLogin()} onChange={(e) => { if (!requireLogin()) return; handleCommentChange(e, false); }} />
                        <button type="submit" className="board-button board-button-primary">{t('common.submit', '등록')}</button>
                    </form>
                </section>
            </div>
        );
    }
    return null;
};

export default Board;
