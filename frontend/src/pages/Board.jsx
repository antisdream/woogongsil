// 게시판 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useScreenSettings from '../useScreenSettings';
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
} from '../features/board/boardUtils.js';

const API_BASE = "";

const isTruthySessionFlag = (value) => (
    value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true'
);

const replaceSettingTokens = (text, values = {}) => {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
};

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

    const tempStateRef = useRef({ title, content });
    
    useEffect(() => {
        tempStateRef.current = { title, content };
    }, [title, content]);

    const saveToLocalList = (t, c, isAuto = false) => {
        if (!t.trim() && !c.trim()) return;
        
        let saves = JSON.parse(localStorage.getItem('board_temp_list') || '[]');
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        
        saves.push({ title: t, content: c, date: dateStr });
        
        if (saves.length >10) saves = saves.slice(saves.length - 10);
        
        localStorage.setItem('board_temp_list', JSON.stringify(saves));

        if (!isAuto) toast.success(t('draft.manual_saved', '수동으로 임시저장되었습니다.'), { autoClose: 2000 });
        else toast.info(t('draft.auto_saved', '자동 임시저장되었습니다.'), { autoClose: 1500 });
    }

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

        // 임시저장 이어쓰기 안내는 로그인 사용자에게만 보여줍니다.
        // 비로그인 상태에서는 글쓰기 화면으로 이동시키지 않아야 합니다.
        if (userId) {
            const saves = JSON.parse(localStorage.getItem('board_temp_list') || '[]');
            if (saves.length >0 && view === 'list') {
                const latestSave = saves[saves.length - 1];
                if (window.confirm(t('draft.resume_confirm', '가장 최근에 작성 중이던 임시저장 글이 있습니다. 이어서 작성하시겠습니까?\n(목록에서 다른 저장본도 불러올 수 있습니다)'))) {
                    setTitle(latestSave.title || '');
                    setContent(latestSave.content || '');
                    navigate(getBoardWritePath(boardTab));
                    setView('write');
                }
            }
        } else {
            // 로그아웃 상태에서는 자유게시판을 볼 수 없으므로 공지게시판으로 되돌립니다.
            setBoardTab(BOARD_NOTICE);
            setSavedList([]);
        }
    }, [boardTab, navigate, t, userId, view]);

    useEffect(() => {
        if (view !== 'write' && !isEditing) return;

        const autoSave = setInterval(() => {
            const { title: t, content: c } = tempStateRef.current;
            if (t.trim() || c.trim()) saveToLocalList(t, c, true);
        }, 60000); 

        const handleBeforeUnload = () => {
            const { title: t, content: c } = tempStateRef.current;
            if (t.trim() || c.trim()) saveToLocalList(t, c, true);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            clearInterval(autoSave);
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [view, isEditing]);

    const handleManualSave = () => {
        // 임시저장은 사용자별 작성 기능이므로 로그인한 사용자만 허용합니다.
        if (!requireLogin()) return;
        if (!title.trim() && !content.trim()) return alert(t('draft.empty_save_alert', '저장할 내용이 없습니다.'));
        saveToLocalList(title, content, false);
    };

    const openLoadModal = () => {
        // 불러오기는 로그인 사용자의 임시저장 목록에서만 사용합니다.
        if (!requireLogin()) return;
        const saves = JSON.parse(localStorage.getItem('board_temp_list') || '[]');
        setSavedList(saves.reverse());
        setShowLoadModal(true);
    };

    const loadSpecificSave = (saveItem) => {
        if(window.confirm(t('draft.load_confirm', '현재 작성 중인 내용이 덮어씌워집니다. 불러오시겠습니까?'))) {
            setTitle(saveItem.title);
            setContent(saveItem.content);
            setShowLoadModal(false);
        }
    };

    const handleDeleteDraft = (indexToDelete) => {
        if(!window.confirm(t('draft.delete_confirm', '정말 이 임시저장 글을 삭제하시겠습니까?'))) return;
        const newSavedList = savedList.filter((_, idx) => idx !== indexToDelete);
        setSavedList(newSavedList);
        const chronologicalSaves = [...newSavedList].reverse();
        localStorage.setItem('board_temp_list', JSON.stringify(chronologicalSaves));
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

    const handleContentChange = (e) => {
        const text = e.target.value;
        if (text.length >1000) {
            alert(t('messages.content_limit_exceeded', '작성 가능한 내용이 1000자가 초과되었습니다.'));
            setContent(text.substring(0, 1000));
        } else { setContent(text); }
    };

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

        if (!title.trim() || !content.trim()) return alert(t('messages.need_title_content', '제목과 내용을 모두 입력해주세요.'));
        try {
            // 핵심: 새 글은 현재 선택한 탭(boardTab)을 content 마커로 저장합니다.
            // - 최고관리자가 자유게시판에서 작성하면 FREE 마커가 붙으므로 공지게시판으로 자동 이동하지 않습니다.
            // - 최고관리자가 공지게시판에서 작성하면 NOTICE 마커가 붙으므로 공지 해제 후에도 공지게시판에 남습니다.
            const finalContent = withBoardMarker(content, boardTab);
            const res = await axios.post(`${API_BASE}/api/posts`, {
                ...getSessionAuth(),
                title: getCleanTitle(title),
                content: finalContent,
                authorId: userId,
                authorName: userName,

                // 백엔드가 새 공지글 작성 여부를 안정적으로 판단할 수 있도록 현재 게시판 탭을 함께 보냅니다.
                // - 기존 content 숨김 마커 방식은 그대로 유지합니다.
                // - 이 값은 공지메일 발송 조건 판단에만 사용되며 게시글/댓글/추천 로직은 유지합니다.
                boardType: boardTab
            });
            if (res.data.success) {
                alert(t('messages.post_created', '게시글이 등록되었습니다.'));
                localStorage.removeItem('board_temp_list'); 
                setTitle(''); setContent('');
                fetchPosts(); navigate(getBoardListPath(boardTab)); setView('list'); setCurrentPage(1);
            }
        } catch (err) { alert(t('messages.create_failed', '등록 실패: 서버 에러')); }
    };

    const handleUpdatePost = async (e) => {
        e.preventDefault();
        // 비로그인 사용자는 게시글 수정 불가
        if (!requireLogin()) return;
        if (!title.trim() || !content.trim()) return alert(t('messages.need_title_content', '제목과 내용을 모두 입력해주세요.'));
        try {
            // 수정할 때는 현재 화면 탭이 아니라 "원래 글의 소속"을 유지합니다.
            // - 공지 등록/해제 또는 수정 때문에 게시판 탭이 바뀌는 것을 방지합니다.
            const originalBoard = getPostBoardType(currentPost) || boardTab;
            const finalContent = withBoardMarker(content, originalBoard);
            const res = await axios.put(`${API_BASE}/api/posts/${currentPost.id}`, {
                ...getSessionAuth(),
                userId,
                title: getCleanTitle(title),
                content: finalContent
            });
            if (res.data.success) {
                alert(t('messages.post_updated', '게시글이 수정되었습니다.'));
                localStorage.removeItem('board_temp_list');
                setIsEditing(false); fetchPosts();
                setCurrentPost({ ...currentPost, title: getCleanTitle(title), content: finalContent }); 
                navigate(getBoardPostPath(currentPost.id));
                setView('detail');
            }
        } catch (err) { alert(err.response?.data?.msg || t('messages.update_failed', '수정 실패')); }
    };

    const handleCancelWrite = () => {
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
            <div className="board-page board-list-page wgs-typography-scope" style={{ width: '100%', maxWidth: '900px', margin: '10px auto', boxSizing: 'border-box', background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', color: 'white' }}>
                <div className="mobile-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px', marginBottom: '20px', gap: '15px' }}>
                    {/* 게시판 목록 제목은 공통 페이지 제목 클래스로 통일합니다. */}
                    <h2 className="wgs-page-title" style={{ color: 'var(--wgs-title)', margin: 0, textAlign: 'center' }}>{pageTitle}</h2>
                    <div className="mobile-stack" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {isAdmin && (
                            <>
                                <button className="mobile-stack-btn" onClick={handleNoticeRegister} style={{ padding: '10px 15px', background: noticeMode === 'register'? '#10b981' : '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    {noticeMode === 'register'? t('admin.notice_register_confirm_button', ' 등록 확인') : t('admin.notice_register_button', ' 공지 등록')}
                                </button>
                                <button className="mobile-stack-btn" onClick={handleNoticeUnregister} style={{ padding: '10px 15px', background: noticeMode === 'unregister'? '#10b981' : '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    {noticeMode === 'unregister'? t('admin.notice_unregister_confirm_button', ' 해제 확인') : t('admin.notice_unregister_button', ' 공지 해제')}
                                </button>
                                <button className="mobile-stack-btn" onClick={handleNoticeOrderToggle} style={{ padding: '10px 15px', background: noticeOrderMode ? '#10b981' : '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    {noticeOrderMode ? t('admin.notice_order_save_button', ' 순서 저장') : t('admin.notice_order_button', ' 공지 순서')}
                                </button>
                                <button className="mobile-stack-btn" onClick={handleBoardMoveToggle} style={{ padding: '10px 15px', background: noticeMode === 'move'? '#10b981' : '#6366f1', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    {noticeMode === 'move'? ` ${targetMoveLabel}` : ` ${targetMoveLabel}`}
                                </button>
                                {(noticeMode !== 'none' || noticeOrderMode) && (
                                    <button onClick={() => { setNoticeMode('none'); setSelectedNoticeIds([]); setNoticeOrderMode(false); setNoticeOrderIds([]); }} style={{ padding: '10px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>{t('common.cancel', '취소')}</button>
                                )}
                            </>
                        )}
                        {(isAdmin || boardTab === BOARD_FREE) && (
                            <button className="mobile-stack-btn" onClick={() => { if (!requireLogin()) return; setActivityTab('posts'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('posts')); setView('myActivity'); }} style={{ padding: '10px 15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{t('list.my_activity_button', '내가 작성한 글/댓글')}</button>
                        )}
                        {(isAdmin || boardTab === BOARD_FREE) && (
                            <button className="mobile-stack-btn" onClick={() => { if (!requireLogin()) return; if (boardTab === BOARD_NOTICE && !isAdmin) return toast.error(t('messages.notice_write_admin_only', '공지게시판 글 등록은 관리자만 가능합니다.')); setTitle(''); setContent(''); setIsEditing(false); navigate(getBoardWritePath(boardTab)); setView('write'); }} style={{ padding: '10px 15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{t('list.write_button', '게시글 등록')}</button>
                        )}
                    </div>
                </div>

                <div className="mobile-stack board-tab-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                    <button type="button" onClick={() => handleChangeBoardTab(BOARD_NOTICE)} style={{ padding: '14px', borderRadius: '10px', border: boardTab === BOARD_NOTICE ? '1px solid #f59e0b' : '1px solid var(--wgs-border)', background: boardTab === BOARD_NOTICE ? 'rgba(245, 158, 11, 0.22)' : 'var(--wgs-button-muted)', color: boardTab === BOARD_NOTICE ? '#fcd34d' : 'white', fontWeight: 'bold', cursor: 'pointer' }}> {boardNoticeLabel}</button>
                    <button type="button" onClick={() => handleChangeBoardTab(BOARD_FREE)} style={{ padding: '14px', borderRadius: '10px', border: boardTab === BOARD_FREE ? '1px solid #3b82f6' : '1px solid var(--wgs-border)', background: boardTab === BOARD_FREE ? 'rgba(59, 130, 246, 0.28)' : 'var(--wgs-button-muted)', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}> {boardFreeLabel}</button>
                </div>

                <p style={{ margin: '0 0 24px 0', lineHeight: 1.6, color: 'var(--wgs-muted)' }}>{boardGuideText}</p>

                <div className="table-wrapper">
                    <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'center' }}>
                        <thead>
                            <tr style={{ background: 'var(--wgs-practice-toggle-bg)', borderBottom: '1px solid var(--wgs-border)' }}>
                                <th style={{ padding: '15px 10px', width: '10%' }}>{t('table.no_header', 'No')}</th>
                                <th style={{ padding: '15px 10px', width: '40%' }}>{t('table.title_header', '제목')}</th>
                                <th style={{ padding: '15px 10px', width: '20%' }}>{t('table.author_header', '작성자')}</th>
                                <th style={{ padding: '15px 10px', width: '15%' }}>{t('table.views_likes_header', '조회/추천')}</th>
                                <th style={{ padding: '15px 10px', width: '15%' }}>{t('table.date_header', '작성일')}</th>
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
                                    <tr key={post.id} style={{ borderBottom: '1px solid var(--wgs-border)', transition: '0.2s', cursor: isSelectableMode || noticeOrderMode ? 'default' : 'pointer', background: post.isNotice ? 'rgba(245, 158, 11, 0.15)' : 'transparent' }} onMouseOver={e => e.currentTarget.style.background = post.isNotice ? 'rgba(245, 158, 11, 0.22)' : 'var(--wgs-input-bg)'} onMouseOut={e => e.currentTarget.style.background = post.isNotice ? 'rgba(245, 158, 11, 0.15)' : 'transparent'}>
                                        <td style={{ padding: '15px 10px', color: post.isNotice ? '#f59e0b' : 'var(--wgs-subtle)', fontWeight: post.isNotice ? 'bold' : 'normal' }}>
                                            {noticeOrderMode ? (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                                    <button type="button" onClick={() => moveNoticeItem(post.id, -1)} disabled={idx === 0} title={t('admin.move_up_title', '위로 이동')} style={{ padding: '4px 7px', borderRadius: '6px', border: '1px solid var(--wgs-border)', background: idx === 0 ? 'var(--wgs-practice-toggle-bg)' : '#374151', color: idx === 0 ? '#64748b' : 'white', cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>{t('admin.move_up_button', '위')}</button>
                                                    <span style={{ minWidth: '28px', color: '#fcd34d' }}>{idx + 1}</span>
                                                    <button type="button" onClick={() => moveNoticeItem(post.id, 1)} disabled={idx === currentPosts.length - 1} title={t('admin.move_down_title', '아래로 이동')} style={{ padding: '4px 7px', borderRadius: '6px', border: '1px solid var(--wgs-border)', background: idx === currentPosts.length - 1 ? 'var(--wgs-practice-toggle-bg)' : '#374151', color: idx === currentPosts.length - 1 ? '#64748b' : 'white', cursor: idx === currentPosts.length - 1 ? 'not-allowed' : 'pointer' }}>{t('admin.move_down_button', '아래')}</button>
                                                </div>
                                            ) : isSelectableMode ? (
                                                <input type="checkbox" checked={selectedNoticeIds.includes(post.id)} onChange={() => toggleNoticeCheckbox(post.id)} style={{ transform: 'scale(1.3)' }} />
                                            ) : post.isNotice ? t('table.notice_cell', ' 공지') : displayNo}
                                        </td>
                                        <td style={{ padding: '15px 10px', textAlign: 'left', color: post.isNotice ? '#fcd34d' : '#e2e8f0', fontWeight: 'bold' }} onClick={() => !isSelectableMode && !noticeOrderMode && handleViewPost(post)}>
                                            {post.isNotice && <span style={{ color: '#f59e0b', fontSize: '12px', marginRight: '5px' }}>{t('table.notice_badge', '[공지]')}</span>}
                                            {getCleanTitle(post.title)} {totalComments >0 && <span style={{ color: '#fbbf24', fontSize: '12px', marginLeft: '5px' }}>[{totalComments}]</span>}
                                        </td>
                                        <td style={{ padding: '15px 10px', color: 'var(--wgs-muted)' }}>{post.authorName}</td>
                                        <td style={{ padding: '15px 10px', color: 'var(--wgs-muted)', fontSize: '13px' }}>{formatSetting('table.views_likes_value', ' {views} /  {likes}', { views: post.views || 0, likes: post.likes || 0 })}</td>
                                        <td style={{ padding: '15px 10px', color: 'var(--wgs-subtle)', fontSize: '13px' }}>{formatDateForList(post.date)}</td>
                                    </tr>
                                );
                            }) : ( <tr><td colSpan="5" style={{ padding: '30px', color: 'var(--wgs-subtle)' }}>{t('table.empty_posts', '게시글이 없습니다.')}</td></tr> )}
                        </tbody>
                    </table>
                </div>

                <div className="mobile-stack" style={{ display: 'flex', gap: '10px', marginTop: '20px', marginBottom: '20px', alignItems: 'center' }}>
                    <select value={sortOrder} onChange={(e) => { setSortOrder(e.target.value); setCurrentPage(1); }} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white', cursor: 'pointer' }}>
                        <option value="desc">{t('sort.desc_label', '최근 작성일 내림차순 정렬')}</option>
                        <option value="asc">{t('sort.asc_label', '최근 작성일 오름차순 정렬')}</option>
                    </select>
                    <input type="text" placeholder={t('search.placeholder', '제목 또는 내용 검색')} value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={noticeOrderMode || safeCurrentPage === 1} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: noticeOrderMode || safeCurrentPage === 1 ? 'var(--wgs-practice-toggle-bg)' : '#3b82f6', color: noticeOrderMode || safeCurrentPage === 1 ? '#64748b' : 'white', cursor: noticeOrderMode || safeCurrentPage === 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t('pagination.prev_button', ' 이전')}</button>
                    <span style={{ color: 'var(--wgs-muted)', fontWeight: 'bold' }}>{noticeOrderMode ? 1 : safeCurrentPage} <span style={{ color: '#64748b' }}>/ {noticeOrderMode ? 1 : totalPages}</span></span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={noticeOrderMode || safeCurrentPage === totalPages} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: noticeOrderMode || safeCurrentPage === totalPages ? 'var(--wgs-practice-toggle-bg)' : '#3b82f6', color: noticeOrderMode || safeCurrentPage === totalPages ? '#64748b' : 'white', cursor: noticeOrderMode || safeCurrentPage === totalPages ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t('pagination.next_button', '다음 ')}</button>
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
            <div className="board-page board-my-page wgs-typography-scope" style={{ width: '100%', maxWidth: '900px', margin: '10px auto', boxSizing: 'border-box', background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', color: 'white' }}>
                <div className="mobile-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '15px' }}>
                    <button className="mobile-stack-btn" onClick={() => { navigate(getBoardListPath(boardTab)); setView('list'); setCurrentPage(1); }} style={{ padding: '10px 15px', background: 'var(--wgs-practice-toggle-bg)', color: 'white', border: '1px solid var(--wgs-border)', borderRadius: '6px', cursor: 'pointer' }}>{t('common.back_to_list', ' 목록으로')}</button>
                    <h2 style={{ color: '#10b981', margin: 0, textAlign: 'center' }}>{t('activity.title', ' 내가 작성한 활동')}</h2>
                </div>
                <div className="mobile-stack" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button onClick={() => { setActivityTab('posts'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('posts')); }} style={{ flex: 1, padding: '12px', background: activityTab === 'posts'? '#3b82f6' : 'var(--wgs-practice-toggle-bg)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{formatSetting('activity.posts_tab', '내가 작성한 글 ({count})', { count: myPosts.length })}</button>
                    <button onClick={() => { setActivityTab('comments'); setCheckedIds([]); setCurrentPage(1); navigate(getBoardActivityPath('comments')); }} style={{ flex: 1, padding: '12px', background: activityTab === 'comments'? '#3b82f6' : 'var(--wgs-practice-toggle-bg)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{formatSetting('activity.comments_tab', '내가 작성한 댓글 ({count})', { count: myComments.length })}</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '10px' }}>
                    <button onClick={() => handleSelectAll(currentItems)} style={{ padding: '8px 12px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>{t('activity.select_all_button', '전체선택')}</button>
                    <button onClick={handleDeleteSelectedActivity} style={{ padding: '8px 12px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>{t('activity.delete_selected_button', '선택 삭제')}</button>
                </div>
                <div className="table-wrapper">
                    <table style={{ width: '100%', minWidth: '500px', borderCollapse: 'collapse', textAlign: 'center', marginBottom: '20px' }}>
                        <thead>
                            <tr style={{ background: 'var(--wgs-practice-toggle-bg)', borderBottom: '1px solid var(--wgs-border)' }}>
                                <th style={{ padding: '15px 10px', width: '5%' }}></th>
                                <th style={{ padding: '15px 10px', width: '65%' }}>{activityTab === 'posts'? t('table.title_header', '제목') : t('activity.comment_table_header', '댓글 내용 / 원문 제목')}</th>
                                <th style={{ padding: '15px 10px', width: '30%' }}>{t('table.date_header', '작성일')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentItems.map((item) => {
                                const uniqueKey = item.uniqueId || item.id;
                                const isChecked = checkedIds.includes(uniqueKey);
                                return (
                                    <tr key={uniqueKey} style={{ borderBottom: '1px solid var(--wgs-border)', background: isChecked ? 'var(--wgs-practice-toggle-bg)' : 'transparent' }}>
                                        <td style={{ padding: '15px 10px' }}>
                                            <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(uniqueKey)} />
                                        </td>
                                        <td style={{ padding: '15px 10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => goToPostById(item.postId || item.id)}>
                                            {activityTab === 'posts'? <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{getCleanTitle(item.title)}</span> : <div><div style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{item.text}</div><div style={{ color: '#64748b', fontSize: '12px' }}>{formatSetting('activity.original_title_label', '원본: {title}', { title: item.postTitle })}</div></div>}
                                        </td>
                                        <td style={{ padding: '15px 10px', color: 'var(--wgs-subtle)' }}>{formatDateForList(item.date)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPageAct === 1} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>{t('pagination.prev_button', '이전')}</button>
                    <span>{safeCurrentPageAct} / {totalPagesAct}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPagesAct, p + 1))} disabled={safeCurrentPageAct === totalPagesAct} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>{t('pagination.next_button', '다음')}</button>
                </div>
            </div>
        );
    }

    if (view === 'write') {
        return (
            <div className="board-page board-detail-page wgs-typography-scope" style={{ width: '100%', maxWidth: '800px', margin: '10px auto', boxSizing: 'border-box', background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', color: 'white', position: 'relative' }}>
                <h2 style={{ borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px', color: 'var(--wgs-title)' }}> {isEditing ? t('write.edit_title', '게시글 수정') : formatSetting('write.create_title', '{board} 글 작성', { board: getBoardLabel(boardTab) })}</h2>
                <form onSubmit={isEditing ? handleUpdatePost : handleCreatePost} style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button type="button" onClick={openLoadModal} style={{ padding: '8px 15px', background: '#10b981', color: 'white', borderRadius: '6px', cursor: 'pointer' }}>{t('write.load_button', ' 불러오기')}</button>
                        <button type="button" onClick={handleManualSave} style={{ padding: '8px 15px', background: '#f59e0b', color: 'white', borderRadius: '6px', cursor: 'pointer' }}>{t('write.temp_save_button', ' 임시저장')}</button>
                    </div>
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('write.title_placeholder', '제목을 입력하세요')} required style={{ width: '100%', padding: '15px', boxSizing: 'border-box', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)' }} />
                    <textarea value={content} onChange={handleContentChange} placeholder={t('write.content_placeholder', '내용을 입력하세요')} required rows="12" style={{ width: '100%', padding: '15px', boxSizing: 'border-box', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)', resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={handleCancelWrite} style={{ padding: '15px 20px', background: 'var(--wgs-border)', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>{t('common.cancel', '취소')}</button>
                        <button type="submit" style={{ padding: '15px 30px', background: '#3b82f6', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>{isEditing ? t('write.update_submit_button', '수정완료') : t('write.create_submit_button', '등록')}</button>
                    </div>
                </form>

                {showLoadModal && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', borderRadius: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                        <div style={{ background: 'var(--wgs-practice-toggle-bg)', width: '90%', maxWidth: '500px', padding: '20px', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px' }}>
                                <h3 style={{ color: '#10b981' }}>{t('draft.modal_title', ' 임시저장 목록')}</h3>
                                <button onClick={() => setShowLoadModal(false)} style={{ background: 'none', color: 'white', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>{t('draft.close_button', '닫기')}</button>
                            </div>
                            <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '15px' }}>
                                {savedList.map((item, idx) => (
                                    <div key={idx} style={{ background: 'var(--wgs-input-bg)', padding: '10px', marginBottom: '10px', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => loadSpecificSave(item)}>
                                        <div><div style={{ fontWeight: 'bold' }}>{item.title || t('draft.no_title', '제목 없음')}</div><div style={{ fontSize: '12px', color: 'var(--wgs-subtle)' }}>{item.date}</div></div>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteDraft(idx); }} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>{t('common.delete', '삭제')}</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (view === 'detail' && currentPost) {
        const totalComments = currentPost.comments.reduce((acc, c) => acc + 1 + (c.replies ? c.replies.length : 0), 0);
        return (
            <div className="board-page board-editor-page wgs-typography-scope" style={{ width: '100%', maxWidth: '800px', margin: '10px auto', boxSizing: 'border-box', background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', color: 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <button onClick={() => { navigate(getBoardListPath(boardTab)); setView('list'); }} style={{ padding: '10px 15px', background: 'var(--wgs-practice-toggle-bg)', border: '1px solid var(--wgs-border)', color: 'white', borderRadius: '6px', cursor: 'pointer' }}>{t('common.back_to_list', ' 목록으로')}</button>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {(userId === currentPost.authorId || isAdmin) && (
                            <>
                                <button onClick={() => { setTitle(getCleanTitle(currentPost.title)); setContent(getCleanContent(currentPost.content)); setIsEditing(true); navigate(getBoardWritePath(getPostBoardType(currentPost))); setView('write'); }} style={{ color: '#10b981', border: '1px solid #10b981', background: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer' }}>{t('common.edit', '수정')}</button>
                                <button onClick={() => handleDeletePost(currentPost.id)} style={{ color: '#ef4444', border: '1px solid #ef4444', background: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer' }}>{t('common.delete', '삭제')}</button>
                            </>
                        )}
                    </div>
                </div>
                <h1 className="wgs-page-title" style={{ color: 'var(--wgs-title)' }}>{currentPost.isNotice && t('detail.notice_prefix', '[공지] ')}{getCleanTitle(currentPost.title)}</h1>
                <div style={{ color: 'var(--wgs-subtle)', fontSize: '14px', marginBottom: '20px' }}>{formatSetting('detail.meta_line', '작성자: {author} | 조회: {views} | 일시: {date}', { author: currentPost.authorName, views: currentPost.views, date: currentPost.date })}</div>
                <div style={{ minHeight: '300px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{getCleanContent(currentPost.content)}</div>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '40px 0' }}>
                    <button onClick={handleToggleLike} style={{ padding: '15px 30px', borderRadius: '30px', background: currentPost.likedUsers?.includes(userId) ? '#ef4444' : 'var(--wgs-practice-toggle-bg)', border: '1px solid #ef4444', color: 'white', cursor: 'pointer' }}>{formatSetting('detail.like_button', ' 추천 {count}', { count: currentPost.likes || 0 })}</button>
                </div>
                <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px' }}>
                    <h3 style={{ color: '#fcd34d' }}>{formatSetting('comments.title', ' 댓글 ({count})', { count: totalComments })}</h3>
                    {currentPost.comments.map(c => (
                        <div key={c.id} style={{ marginBottom: '15px', borderLeft: '3px solid #3b82f6', paddingLeft: '15px' }}>
                            <div style={{ fontWeight: 'bold' }}>{c.authorName} <span style={{ fontSize: '12px', color: '#64748b' }}>{c.date}</span></div>
                            <div style={{ margin: '5px 0' }}>{c.text}</div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={() => { if (!requireLogin()) return; setReplyingTo(replyingTo === c.id ? null : c.id); }} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer' }}>{t('comments.reply_button', '답글')}</button>
                                {(userId === c.authorId || isAdmin) && <button onClick={() => handleDeleteComment(c.id, c.replies?.length >0)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}>{t('common.delete', '삭제')}</button>}
                            </div>
                            {replyingTo === c.id && (
                                <form onSubmit={(e) => handleAddReply(e, c.id)} style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                                    <textarea value={replyText} readOnly={!isLoggedIn} placeholder={t('comments.reply_placeholder', '답글을 입력하세요')} onFocus={() => !isLoggedIn && requireLogin()} onChange={(e) => { if (!requireLogin()) return; handleCommentChange(e, true); }} style={{ flex: 1, background: 'var(--wgs-input-bg)', color: 'white', borderRadius: '4px', border: '1px solid var(--wgs-border)' }} />
                                    <button type="submit" style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', padding: '10px' }}>{t('common.submit', '등록')}</button>
                                </form>
                            )}
                            {c.replies?.map(r => (
                                <div key={r.id} style={{ marginLeft: '20px', borderLeft: '2px solid var(--wgs-border)', paddingLeft: '10px', marginTop: '10px', fontSize: '14px' }}>
                                    <div style={{ fontWeight: 'bold' }}>↳ {r.authorName}</div>
                                    <div>{r.text}</div>
                                </div>
                            ))}
                        </div>
                    ))}
                    <form onSubmit={handleAddComment} style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                        <textarea value={commentText} readOnly={!isLoggedIn} placeholder={t('comments.comment_placeholder', '댓글을 입력하세요')} onFocus={() => !isLoggedIn && requireLogin()} onChange={(e) => { if (!requireLogin()) return; handleCommentChange(e, false); }} style={{ flex: 1, background: 'var(--wgs-input-bg)', color: 'white', borderRadius: '8px', border: '1px solid var(--wgs-border)', padding: '10px' }} />
                        <button type="submit" style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '15px' }}>{t('common.submit', '등록')}</button>
                    </form>
                </div>
            </div>
        );
    }
    return null;
};

export default Board;
