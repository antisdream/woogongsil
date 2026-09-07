import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import {
    FiBookOpen,
    FiArchive,
    FiChevronRight,
    FiClock,
    FiDownload,
    FiFilePlus,
    FiFileText,
    FiFolder,
    FiRefreshCw,
    FiSave,
    FiShare2,
    FiTrash2,
} from 'react-icons/fi';
import BoardBlockNoteEditor from '../features/board/BoardBlockNoteEditor.jsx';
import BoardContentView from '../features/board/BoardContentView.jsx';
import StudyDocumentList from '../features/study/StudyDocumentList.jsx';
import StudyDraftModal from '../features/study/StudyDraftModal.jsx';
import StudyTreeContextMenu from '../features/study/StudyTreeContextMenu.jsx';
import StudyWrongNoteModal from '../features/study/StudyWrongNoteModal.jsx';
import {
    buildDraftSignature,
    formatDraftNow,
    hasDraftableContent,
} from '../features/study/studyDraftUtils.js';
import {
    STUDY_ROOT_FOLDER,
    STUDY_SCOPE_MINE,
    STUDY_SCOPE_PUBLIC,
    appendWrongNotesToStudyDocument,
    contentHasWrongNoteCommand,
    flattenStudyFolders,
    getInitialStudyRoute,
    getStudyAuthPayload,
    isStudyLoggedIn,
    isRouteNumber,
    normalizeStudyFolderKey,
    normalizeTreeParentId,
    sanitizeStudyDownloadFileName,
    sortByStudyOrder,
} from '../features/study/studyNoteUtils.js';
import '../features/study/studyNotes.css';

const API_BASE = '';
const STUDY_DRAFT_PAGE_SIZE = 10;

const emptyEditorState = {
    id: null,
    title: '',
    content: '',
    contentJson: '',
    folderId: null,
    visibility: 'private',
    docType: 'note',
    ownerId: '',
    updatedAt: '',
    createdAt: '',
    wrongRefs: [],
};

function getAuthParams() {
    return getStudyAuthPayload();
}

function StudyNotes() {
    const loggedIn = isStudyLoggedIn();
    const auth = useMemo(() => getStudyAuthPayload(), []);
    const userId = auth.userId;
    const commandOpenRef = useRef('');
    const initialRoute = useMemo(() => getInitialStudyRoute(), []);
    const initialDocumentLoadRef = useRef(false);

    const [scope, setScope] = useState(initialRoute.scope);
    const [folders, setFolders] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [selectedFolderKey, setSelectedFolderKey] = useState(initialRoute.selectedFolderKey);
    const [selectedDocumentId, setSelectedDocumentId] = useState(null);
    const [editorState, setEditorState] = useState(emptyEditorState);
    const [editorKey, setEditorKey] = useState(0);
    const [folderName, setFolderName] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loadingTree, setLoadingTree] = useState(false);
    const [loadingDocument, setLoadingDocument] = useState(false);
    const [saving, setSaving] = useState(false);
    const [wrongModalOpen, setWrongModalOpen] = useState(false);
    const [wrongKind, setWrongKind] = useState('all');
    const [wrongSearch, setWrongSearch] = useState('');
    const [wrongNotes, setWrongNotes] = useState([]);
    const [selectedWrongIds, setSelectedWrongIds] = useState(new Set());
    const [loadingWrongs, setLoadingWrongs] = useState(false);
    const [expandedTreeKeys, setExpandedTreeKeys] = useState(() => new Set([STUDY_ROOT_FOLDER, 'all']));
    const [treeContextMenu, setTreeContextMenu] = useState(null);
    const [draggedTreeItem, setDraggedTreeItem] = useState(null);
    const [dropTargetKey, setDropTargetKey] = useState('');
    const [draftModalOpen, setDraftModalOpen] = useState(false);
    const [drafts, setDrafts] = useState([]);
    const [draftPage, setDraftPage] = useState(1);
    const [draftTotalPages, setDraftTotalPages] = useState(1);
    const [draftTotal, setDraftTotal] = useState(0);
    const [loadingDrafts, setLoadingDrafts] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    const [lastDraftSavedAt, setLastDraftSavedAt] = useState('');
    const editorStateRef = useRef(emptyEditorState);
    const canEditCurrentDocumentRef = useRef(false);
    const lastDraftSignatureRef = useRef(buildDraftSignature(emptyEditorState));

    const flatFolders = useMemo(() => flattenStudyFolders(folders), [folders]);
    const selectedFolderId = selectedFolderKey === STUDY_ROOT_FOLDER ? null : Number(selectedFolderKey);
    const folderParentKeyByKey = useMemo(() => {
        const nextMap = new Map();
        flatFolders.forEach((folder) => {
            nextMap.set(String(folder.id), normalizeStudyFolderKey(folder.parentId));
        });
        return nextMap;
    }, [flatFolders]);
    const childFolderCountByParentKey = useMemo(() => {
        const nextMap = new Map();
        flatFolders.forEach((folder) => {
            const parentKey = normalizeStudyFolderKey(folder.parentId);
            nextMap.set(parentKey, (nextMap.get(parentKey) || 0) + 1);
        });
        return nextMap;
    }, [flatFolders]);
    const folderNameByKey = useMemo(() => {
        const nextMap = new Map([[STUDY_ROOT_FOLDER, '루트']]);
        flatFolders.forEach((folder) => {
            nextMap.set(String(folder.id), folder.name);
        });
        return nextMap;
    }, [flatFolders]);
    const folderByKey = useMemo(() => {
        const nextMap = new Map();
        flatFolders.forEach((folder) => {
            nextMap.set(String(folder.id), folder);
        });
        return nextMap;
    }, [flatFolders]);
    const documentCountByFolderKey = useMemo(() => {
        const nextMap = new Map([[STUDY_ROOT_FOLDER, 0], ['all', documents.length]]);
        documents.forEach((document) => {
            const folderKey = normalizeStudyFolderKey(document.folderId);
            nextMap.set(folderKey, (nextMap.get(folderKey) || 0) + 1);
        });
        return nextMap;
    }, [documents]);
    const documentsByFolderKey = useMemo(() => {
        const nextMap = new Map();
        documents.forEach((document) => {
            const folderKey = normalizeStudyFolderKey(document.folderId);
            const folderDocuments = nextMap.get(folderKey) || [];
            folderDocuments.push(document);
            nextMap.set(folderKey, folderDocuments);
        });
        nextMap.forEach((folderDocuments) => folderDocuments.sort(sortByStudyOrder));
        return nextMap;
    }, [documents]);
    const getDocumentFolderName = useCallback((folderId) => (
        folderNameByKey.get(normalizeStudyFolderKey(folderId)) || '루트'
    ), [folderNameByKey]);
    const isTreeKeyExpanded = useCallback((key) => expandedTreeKeys.has(String(key)), [expandedTreeKeys]);
    const toggleTreeKey = useCallback((key) => {
        const normalizedKey = String(key);
        setExpandedTreeKeys((previous) => {
            const next = new Set(previous);
            if (next.has(normalizedKey)) next.delete(normalizedKey);
            else next.add(normalizedKey);
            return next;
        });
    }, []);
    const isFolderVisible = useCallback((folder) => {
        if (!expandedTreeKeys.has(STUDY_ROOT_FOLDER)) return false;
        let parentKey = normalizeStudyFolderKey(folder.parentId);
        const seenKeys = new Set();
        while (parentKey && parentKey !== STUDY_ROOT_FOLDER) {
            if (seenKeys.has(parentKey)) return false;
            seenKeys.add(parentKey);
            if (!expandedTreeKeys.has(parentKey)) return false;
            parentKey = folderParentKeyByKey.get(parentKey) || STUDY_ROOT_FOLDER;
        }
        return true;
    }, [expandedTreeKeys, folderParentKeyByKey]);
    const visibleFolders = useMemo(() => (
        flatFolders.filter((folder) => isFolderVisible(folder))
    ), [flatFolders, isFolderVisible]);
    const canEditCurrentDocument = Boolean(
        loggedIn &&
        scope === STUDY_SCOPE_MINE &&
        (!editorState.id || String(editorState.ownerId || userId) === String(userId))
    );
    const canShareCurrentDocument = Boolean(editorState.id && editorState.visibility === 'public');
    const canSaveCurrentDraft = Boolean(canEditCurrentDocument && hasDraftableContent(editorState));
    const editorHeading = canEditCurrentDocument
        ? (editorState.id ? '문서 편집' : '새 문서')
        : (editorState.id ? '공개 문서 보기' : '공개 문서 선택');

    useEffect(() => {
        editorStateRef.current = editorState;
    }, [editorState]);

    useEffect(() => {
        canEditCurrentDocumentRef.current = canEditCurrentDocument;
    }, [canEditCurrentDocument]);

    const resetDraftBaseline = useCallback((nextState = editorStateRef.current) => {
        lastDraftSignatureRef.current = buildDraftSignature(nextState);
    }, []);

    const filteredDocuments = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        return documents.filter((document) => {
            const sameFolder = scope === STUDY_SCOPE_PUBLIC
                || selectedFolderKey === 'all'
                || normalizeStudyFolderKey(document.folderId) === selectedFolderKey;
            const matchesKeyword = !keyword
                || String(document.title || '').toLowerCase().includes(keyword)
                || String(document.ownerId || '').toLowerCase().includes(keyword);
            return sameFolder && matchesKeyword;
        });
    }, [documents, scope, searchTerm, selectedFolderKey]);

    const selectedWrongNotes = useMemo(() => (
        wrongNotes.filter((wrong) => selectedWrongIds.has(wrong.sourceId))
    ), [wrongNotes, selectedWrongIds]);

    const visibleWrongNotes = useMemo(() => {
        const keyword = wrongSearch.trim().toLowerCase();
        if (!keyword) return wrongNotes;
        return wrongNotes.filter((wrong) => [
            wrong.sourceLabel,
            wrong.sourceTitle,
            wrong.sourceDetail,
            wrong.questionText,
            wrong.correctAnswer,
            wrong.userAnswer,
            wrong.explanation,
        ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    }, [wrongNotes, wrongSearch]);

    const buildDraftPayload = useCallback((state, saveReason = 'manual') => ({
        ...getAuthParams(),
        documentId: state.id || null,
        folderId: state.folderId || null,
        title: state.title || '',
        content: state.content || '',
        contentJson: state.contentJson || '',
        visibility: state.visibility || 'private',
        docType: state.docType || 'note',
        wrongRefs: state.wrongRefs || [],
        saveReason,
    }), []);

    const saveDraftOnExit = useCallback((saveReason = 'exit', options = {}) => {
        const state = editorStateRef.current;
        if (!canEditCurrentDocumentRef.current || !hasDraftableContent(state)) return false;

        const signature = buildDraftSignature(state);
        if (signature === lastDraftSignatureRef.current) return false;
        lastDraftSignatureRef.current = signature;

        const payload = buildDraftPayload(state, saveReason);
        const body = JSON.stringify(payload);
        const url = `${API_BASE}/api/study/drafts`;
        let sent = false;

        if (navigator.sendBeacon) {
            try {
                sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
            } catch {
                sent = false;
            }
        }

        if (!sent) {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                credentials: 'include',
                keepalive: true,
            }).catch(() => {});
        }

        if (options.updateStatus !== false) setLastDraftSavedAt(formatDraftNow());
        return true;
    }, [buildDraftPayload]);

    useEffect(() => {
        const handleExit = () => {
            saveDraftOnExit('exit');
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') saveDraftOnExit('exit');
        };

        window.addEventListener('beforeunload', handleExit);
        window.addEventListener('pagehide', handleExit);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            saveDraftOnExit('exit', { updateStatus: false });
            window.removeEventListener('beforeunload', handleExit);
            window.removeEventListener('pagehide', handleExit);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [saveDraftOnExit]);

    const loadTree = useCallback(async (nextScope = scope) => {
        if (!loggedIn) return;
        setLoadingTree(true);
        try {
            const response = await axios.get(`${API_BASE}/api/study/tree`, {
                params: { ...getAuthParams(), scope: nextScope },
            });
            setFolders(response.data.folders || []);
            setDocuments(response.data.documents || []);
        } catch (error) {
            console.error('[학습노트] 목록 조회 실패:', error);
            toast.error(error.response?.data?.msg || '학습노트 목록을 불러오지 못했습니다.');
        } finally {
            setLoadingTree(false);
        }
    }, [loggedIn, scope]);

    const loadDrafts = useCallback(async (nextPage = draftPage) => {
        if (!loggedIn) return;
        setLoadingDrafts(true);
        try {
            const response = await axios.get(`${API_BASE}/api/study/drafts`, {
                params: {
                    ...getAuthParams(),
                    page: nextPage,
                    pageSize: STUDY_DRAFT_PAGE_SIZE,
                },
            });
            setDrafts(response.data.drafts || []);
            setDraftPage(response.data.page || nextPage);
            setDraftTotalPages(response.data.totalPages || 1);
            setDraftTotal(response.data.total || 0);
        } catch (error) {
            console.error('[학습노트] 임시저장 목록 조회 실패:', error);
            toast.error(error.response?.data?.msg || '임시저장 목록을 불러오지 못했습니다.');
        } finally {
            setLoadingDrafts(false);
        }
    }, [draftPage, loggedIn]);

    const openDraftModal = useCallback(() => {
        if (!loggedIn) {
            toast.info('로그인 후 임시저장을 사용할 수 있습니다.');
            return;
        }
        setDraftModalOpen(true);
        setDraftPage(1);
    }, [loggedIn]);

    useEffect(() => {
        if (draftModalOpen) loadDrafts(draftPage);
    }, [draftModalOpen, draftPage, loadDrafts]);

    const updateStudyLocation = useCallback((nextScope, options = {}) => {
        if (typeof window === 'undefined') return;
        const {
            documentId = null,
            folderKey = null,
        } = typeof options === 'object' && options !== null ? options : { documentId: options };
        const nextUrl = new URL(window.location.href);
        if (nextScope === STUDY_SCOPE_PUBLIC) {
            nextUrl.searchParams.set('scope', 'public');
            if (documentId) nextUrl.searchParams.set('doc', String(documentId));
            else nextUrl.searchParams.delete('doc');
            nextUrl.searchParams.delete('folder');
            nextUrl.searchParams.delete('folderId');
        } else {
            nextUrl.searchParams.delete('scope');
            nextUrl.searchParams.delete('documentId');
            nextUrl.searchParams.delete('folderId');
            if (documentId) nextUrl.searchParams.set('doc', String(documentId));
            else nextUrl.searchParams.delete('doc');
            if (isRouteNumber(folderKey)) nextUrl.searchParams.set('folder', String(folderKey));
            else nextUrl.searchParams.delete('folder');
        }
        window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }, []);

    const loadDocument = useCallback(async (documentId) => {
        if (!documentId || !loggedIn) return;
        setLoadingDocument(true);
        try {
            const response = await axios.get(`${API_BASE}/api/study/documents/${documentId}`, {
                params: getAuthParams(),
            });
            const document = response.data.document || {};
            setSelectedDocumentId(document.id);
            const nextEditorState = {
                ...emptyEditorState,
                ...document,
                folderId: document.folderId || null,
                visibility: document.visibility || 'private',
                docType: document.docType || 'note',
                wrongRefs: document.wrongRefs || [],
            };
            setEditorState(nextEditorState);
            resetDraftBaseline(nextEditorState);
            setEditorKey((value) => value + 1);
            if (scope === STUDY_SCOPE_PUBLIC && document.visibility === 'public') {
                updateStudyLocation(STUDY_SCOPE_PUBLIC, { documentId: document.id });
            } else if (scope === STUDY_SCOPE_MINE) {
                const documentFolderKey = normalizeStudyFolderKey(document.folderId);
                setSelectedFolderKey(documentFolderKey);
                updateStudyLocation(STUDY_SCOPE_MINE, {
                    documentId: document.id,
                    folderKey: documentFolderKey,
                });
            }
        } catch (error) {
            console.error('[학습노트] 문서 조회 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 불러오지 못했습니다.');
        } finally {
            setLoadingDocument(false);
        }
    }, [loggedIn, resetDraftBaseline, scope, updateStudyLocation]);

    useEffect(() => {
        loadTree(scope);
    }, [loadTree, scope]);

    useEffect(() => {
        if (scope !== STUDY_SCOPE_MINE || !isRouteNumber(selectedFolderKey)) return;
        if (!folderByKey.has(String(selectedFolderKey))) return;

        setExpandedTreeKeys((previous) => {
            const next = new Set(previous);
            let changed = false;
            const addKey = (key) => {
                if (!next.has(key)) {
                    next.add(key);
                    changed = true;
                }
            };
            addKey(STUDY_ROOT_FOLDER);
            let cursor = String(selectedFolderKey);
            const seenKeys = new Set();
            while (cursor && cursor !== STUDY_ROOT_FOLDER && !seenKeys.has(cursor)) {
                seenKeys.add(cursor);
                addKey(cursor);
                const parentKey = normalizeStudyFolderKey(folderByKey.get(cursor)?.parentId);
                if (!parentKey || parentKey === STUDY_ROOT_FOLDER) break;
                cursor = parentKey;
            }
            return changed ? next : previous;
        });
    }, [folderByKey, scope, selectedFolderKey]);

    useEffect(() => {
        if (!loggedIn || initialDocumentLoadRef.current || !initialRoute.documentId) return;
        initialDocumentLoadRef.current = true;
        loadDocument(initialRoute.documentId);
    }, [initialRoute.documentId, loadDocument, loggedIn]);

    useEffect(() => {
        const closeMenu = () => setTreeContextMenu(null);
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') closeMenu();
        };
        window.addEventListener('click', closeMenu);
        window.addEventListener('resize', closeMenu);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('resize', closeMenu);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const handleScopeChange = (nextScope) => {
        setScope(nextScope);
        setSelectedFolderKey(nextScope === STUDY_SCOPE_PUBLIC ? 'all' : STUDY_ROOT_FOLDER);
        setSelectedDocumentId(null);
        setEditorState(emptyEditorState);
        resetDraftBaseline(emptyEditorState);
        setEditorKey((value) => value + 1);
        updateStudyLocation(nextScope);
    };

    const handleSelectFolder = useCallback((folderKey) => {
        setSelectedFolderKey(folderKey);
        updateStudyLocation(scope, { folderKey });
    }, [scope, updateStudyLocation]);

    const handleCreateFolder = async () => {
        const name = folderName.trim();
        if (!name) {
            toast.info('폴더 이름을 입력해주세요.');
            return;
        }
        if (scope !== STUDY_SCOPE_MINE) {
            toast.info('내 학습노트에서만 폴더를 만들 수 있습니다.');
            return;
        }

        try {
            const response = await axios.post(`${API_BASE}/api/study/folders`, {
                ...getAuthParams(),
                parentId: selectedFolderId,
                name,
            });
            const createdFolderId = response.data?.folder?.id || response.data?.id;
            const createdFolderKey = createdFolderId ? String(createdFolderId) : selectedFolderKey;
            setExpandedTreeKeys((previous) => new Set([
                ...previous,
                STUDY_ROOT_FOLDER,
                selectedFolderKey,
                createdFolderKey,
            ]));
            if (isRouteNumber(createdFolderKey)) {
                setSelectedFolderKey(createdFolderKey);
                updateStudyLocation(STUDY_SCOPE_MINE, { folderKey: createdFolderKey });
            }
            setFolderName('');
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('폴더를 만들었습니다.');
        } catch (error) {
            console.error('[학습노트] 폴더 생성 실패:', error);
            toast.error(error.response?.data?.msg || '폴더를 만들지 못했습니다.');
        }
    };

    const handleDeleteFolder = async () => {
        if (!selectedFolderId) {
            toast.info('삭제할 폴더를 선택해주세요.');
            return;
        }
        if (!window.confirm('선택한 폴더를 삭제할까요? 폴더 안에 문서가 있으면 삭제되지 않습니다.')) return;

        try {
            await axios.delete(`${API_BASE}/api/study/folders/${selectedFolderId}`, {
                params: getAuthParams(),
                data: getAuthParams(),
            });
            setSelectedFolderKey(STUDY_ROOT_FOLDER);
            updateStudyLocation(STUDY_SCOPE_MINE);
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('폴더를 삭제했습니다.');
        } catch (error) {
            console.error('[학습노트] 폴더 삭제 실패:', error);
            toast.error(error.response?.data?.msg || '폴더를 삭제하지 못했습니다.');
        }
    };

    const handleNewDocument = () => {
        if (scope !== STUDY_SCOPE_MINE) {
            toast.info('내 학습노트에서만 새 문서를 만들 수 있습니다.');
            return;
        }
        const nextEditorState = {
            ...emptyEditorState,
            folderId: selectedFolderId,
            ownerId: userId,
            title: '새 학습노트',
        };
        setSelectedDocumentId('new');
        setEditorState(nextEditorState);
        resetDraftBaseline(nextEditorState);
        setEditorKey((value) => value + 1);
        updateStudyLocation(STUDY_SCOPE_MINE, { folderKey: selectedFolderKey });
    };

    const handleSaveDocument = async () => {
        if (!canEditCurrentDocument) return;
        const title = editorState.title.trim();
        if (!title) {
            toast.info('문서 제목을 입력해주세요.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...getAuthParams(),
                folderId: editorState.folderId || null,
                title,
                content: editorState.content || '',
                contentJson: editorState.contentJson || '',
                visibility: editorState.visibility,
                docType: editorState.docType,
                wrongRefs: editorState.wrongRefs || [],
            };
            const isExisting = editorState.id && selectedDocumentId !== 'new';
            const response = isExisting
                ? await axios.put(`${API_BASE}/api/study/documents/${editorState.id}`, payload)
                : await axios.post(`${API_BASE}/api/study/documents`, payload);
            const savedDocument = response.data.document || {};
            const savedFolderKey = normalizeStudyFolderKey(savedDocument.folderId);
            const nextEditorState = {
                ...editorState,
                ...savedDocument,
                wrongRefs: editorState.wrongRefs || [],
            };
            setSelectedDocumentId(savedDocument.id);
            setSelectedFolderKey(savedFolderKey);
            setEditorState(nextEditorState);
            resetDraftBaseline(nextEditorState);
            updateStudyLocation(STUDY_SCOPE_MINE, {
                documentId: savedDocument.id,
                folderKey: savedFolderKey,
            });
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('문서를 저장했습니다.');
        } catch (error) {
            console.error('[학습노트] 문서 저장 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 저장하지 못했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveDraft = async () => {
        if (!canEditCurrentDocument) return;
        if (!hasDraftableContent(editorState)) {
            toast.info('임시저장할 내용이 없습니다.');
            return;
        }

        setSavingDraft(true);
        try {
            const payload = buildDraftPayload(editorState, 'manual');
            const response = await axios.post(`${API_BASE}/api/study/drafts`, payload);
            const savedAt = response.data?.draft?.savedAt || formatDraftNow();
            resetDraftBaseline(editorState);
            setLastDraftSavedAt(savedAt);
            if (draftModalOpen) await loadDrafts(1);
            toast.success('임시저장했습니다.');
        } catch (error) {
            console.error('[학습노트] 임시저장 실패:', error);
            toast.error(error.response?.data?.msg || '임시저장하지 못했습니다.');
        } finally {
            setSavingDraft(false);
        }
    };

    const handleLoadDraft = async (draftId) => {
        if (!draftId || !loggedIn) return;
        saveDraftOnExit('auto');
        try {
            const response = await axios.get(`${API_BASE}/api/study/drafts/${draftId}`, {
                params: getAuthParams(),
            });
            const draft = response.data.draft || {};
            const nextEditorState = {
                ...emptyEditorState,
                id: draft.documentId || null,
                folderId: draft.folderId || null,
                ownerId: userId,
                title: draft.title || '제목 없음',
                content: draft.content || '',
                contentJson: draft.contentJson || '',
                visibility: draft.visibility || 'private',
                docType: draft.docType || 'note',
                wrongRefs: draft.wrongRefs || [],
                updatedAt: draft.savedAt || '',
            };
            const nextFolderKey = normalizeStudyFolderKey(nextEditorState.folderId);
            setSelectedDocumentId(nextEditorState.id || 'new');
            setSelectedFolderKey(nextFolderKey);
            setEditorState(nextEditorState);
            resetDraftBaseline(nextEditorState);
            setEditorKey((value) => value + 1);
            setDraftModalOpen(false);
            updateStudyLocation(STUDY_SCOPE_MINE, {
                documentId: nextEditorState.id,
                folderKey: nextFolderKey,
            });
            toast.success('임시저장을 불러왔습니다.');
        } catch (error) {
            console.error('[학습노트] 임시저장 불러오기 실패:', error);
            toast.error(error.response?.data?.msg || '임시저장을 불러오지 못했습니다.');
        }
    };

    const handleDeleteDraft = async (draftId) => {
        if (!draftId) return;
        if (!window.confirm('이 임시저장을 삭제할까요?')) return;
        try {
            await axios.delete(`${API_BASE}/api/study/drafts/${draftId}`, {
                params: getAuthParams(),
                data: getAuthParams(),
            });
            const nextPage = drafts.length === 1 && draftPage > 1 ? draftPage - 1 : draftPage;
            setDraftPage(nextPage);
            await loadDrafts(nextPage);
            toast.success('임시저장을 삭제했습니다.');
        } catch (error) {
            console.error('[학습노트] 임시저장 삭제 실패:', error);
            toast.error(error.response?.data?.msg || '임시저장을 삭제하지 못했습니다.');
        }
    };

    const handleDeleteDocument = async () => {
        if (!editorState.id || !canEditCurrentDocument) return;
        if (!window.confirm('이 문서를 삭제할까요?')) return;

        try {
            await axios.delete(`${API_BASE}/api/study/documents/${editorState.id}`, {
                params: getAuthParams(),
                data: getAuthParams(),
            });
            setSelectedDocumentId(null);
            setEditorState(emptyEditorState);
            resetDraftBaseline(emptyEditorState);
            setEditorKey((value) => value + 1);
            updateStudyLocation(STUDY_SCOPE_MINE, { folderKey: selectedFolderKey });
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('문서를 삭제했습니다.');
        } catch (error) {
            console.error('[학습노트] 문서 삭제 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 삭제하지 못했습니다.');
        }
    };

    const openTreeContextMenu = (event, item) => {
        if (scope !== STUDY_SCOPE_MINE) return;
        event.preventDefault();
        event.stopPropagation();
        setTreeContextMenu({
            ...item,
            x: event.clientX,
            y: event.clientY,
        });
    };

    const handleRenameTreeItem = async (item = treeContextMenu) => {
        if (!item || scope !== STUDY_SCOPE_MINE) return;
        const currentName = item.type === 'folder'
            ? item.folder?.name
            : item.document?.title;
        const nextName = window.prompt(item.type === 'folder' ? '폴더명을 변경합니다.' : '문서명을 변경합니다.', currentName || '');
        const cleanName = String(nextName || '').trim();
        setTreeContextMenu(null);
        if (!cleanName || cleanName === currentName) return;

        try {
            if (item.type === 'folder') {
                await axios.put(`${API_BASE}/api/study/folders/${item.folder.id}`, {
                    ...getAuthParams(),
                    parentId: item.folder.parentId || null,
                    name: cleanName,
                    sortOrder: item.folder.sortOrder || 0,
                });
                if (selectedFolderKey === String(item.folder.id)) {
                    setSelectedFolderKey(String(item.folder.id));
                }
            } else if (item.type === 'document') {
                const response = await axios.patch(`${API_BASE}/api/study/documents/${item.document.id}/meta`, {
                    ...getAuthParams(),
                    title: cleanName,
                });
                if (String(selectedDocumentId) === String(item.document.id)) {
                    setEditorState((previous) => ({
                        ...previous,
                        ...(response.data.document || {}),
                        title: cleanName,
                    }));
                }
            }
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('이름을 변경했습니다.');
        } catch (error) {
            console.error('[학습노트] 이름 변경 실패:', error);
            toast.error(error.response?.data?.msg || '이름을 변경하지 못했습니다.');
        }
    };

    const getFolderSiblings = useCallback((parentKey) => (
        flatFolders
            .filter((folder) => normalizeStudyFolderKey(folder.parentId) === parentKey)
            .sort(sortByStudyOrder)
    ), [flatFolders]);

    const getDocumentSiblings = useCallback((folderKey) => (
        (documentsByFolderKey.get(folderKey) || []).slice().sort(sortByStudyOrder)
    ), [documentsByFolderKey]);

    const saveTreeOrder = async ({ nextFolders = [], nextDocuments = [] }) => {
        if (!nextFolders.length && !nextDocuments.length) return;
        await axios.post(`${API_BASE}/api/study/reorder`, {
            ...getAuthParams(),
            folders: nextFolders,
            documents: nextDocuments,
        });
        await loadTree(STUDY_SCOPE_MINE);
    };

    const buildOrderedUpdates = (items, idKey, parentKey, parentField) => (
        items.map((item, index) => ({
            id: item[idKey],
            [parentField]: normalizeTreeParentId(parentKey),
            sortOrder: (index + 1) * 10,
        }))
    );

    const moveFolderInto = async (folder, parentKey) => {
        if (!folder) return;
        const folderKey = String(folder.id);
        if (parentKey === folderKey) {
            toast.info('자기 자신 안으로 이동할 수 없습니다.');
            return;
        }

        let cursor = parentKey;
        while (cursor && cursor !== STUDY_ROOT_FOLDER) {
            if (cursor === folderKey) {
                toast.info('하위 폴더 안으로 이동할 수 없습니다.');
                return;
            }
            cursor = normalizeStudyFolderKey(folderByKey.get(cursor)?.parentId);
        }

        const siblings = getFolderSiblings(parentKey).filter((item) => String(item.id) !== folderKey);
        const nextFolders = buildOrderedUpdates([...siblings, folder], 'id', parentKey, 'parentId');
        await saveTreeOrder({ nextFolders });
    };

    const moveDocumentInto = async (document, folderKey) => {
        if (!document) return;
        const documentKey = String(document.id);
        const siblings = getDocumentSiblings(folderKey).filter((item) => String(item.id) !== documentKey);
        const nextDocuments = buildOrderedUpdates([...siblings, document], 'id', folderKey, 'folderId');
        await saveTreeOrder({ nextDocuments });
    };

    const moveFolderBefore = async (folder, targetFolder) => {
        if (!folder || !targetFolder || String(folder.id) === String(targetFolder.id)) return;
        const parentKey = normalizeStudyFolderKey(targetFolder.parentId);
        const folderKey = String(folder.id);
        const nextItems = [];
        getFolderSiblings(parentKey)
            .filter((item) => String(item.id) !== folderKey)
            .forEach((item) => {
                if (String(item.id) === String(targetFolder.id)) nextItems.push(folder);
                nextItems.push(item);
            });
        const nextFolders = buildOrderedUpdates(nextItems, 'id', parentKey, 'parentId');
        await saveTreeOrder({ nextFolders });
    };

    const moveDocumentBefore = async (document, targetDocument) => {
        if (!document || !targetDocument || String(document.id) === String(targetDocument.id)) return;
        const folderKey = normalizeStudyFolderKey(targetDocument.folderId);
        const documentKey = String(document.id);
        const nextItems = [];
        getDocumentSiblings(folderKey)
            .filter((item) => String(item.id) !== documentKey)
            .forEach((item) => {
                if (String(item.id) === String(targetDocument.id)) nextItems.push(document);
                nextItems.push(item);
            });
        const nextDocuments = buildOrderedUpdates(nextItems, 'id', folderKey, 'folderId');
        await saveTreeOrder({ nextDocuments });
    };

    const handleTreeDrop = async (event, target) => {
        event.preventDefault();
        event.stopPropagation();
        const source = draggedTreeItem;
        setDropTargetKey('');
        setDraggedTreeItem(null);
        if (!source || scope !== STUDY_SCOPE_MINE) return;

        try {
            if (source.type === 'folder') {
                const folder = folderByKey.get(String(source.id));
                if (!folder) return;
                if (target.type === 'root') await moveFolderInto(folder, STUDY_ROOT_FOLDER);
                else if (target.type === 'folder') {
                    const targetFolder = folderByKey.get(String(target.id));
                    const sameParent = normalizeStudyFolderKey(folder.parentId) === normalizeStudyFolderKey(targetFolder?.parentId);
                    if (sameParent) await moveFolderBefore(folder, targetFolder);
                    else await moveFolderInto(folder, String(target.id));
                } else if (target.type === 'document') {
                    await moveFolderInto(folder, normalizeStudyFolderKey(target.document?.folderId));
                }
            } else if (source.type === 'document') {
                const document = documents.find((item) => String(item.id) === String(source.id));
                if (!document) return;
                if (target.type === 'root') await moveDocumentInto(document, STUDY_ROOT_FOLDER);
                else if (target.type === 'folder') await moveDocumentInto(document, String(target.id));
                else if (target.type === 'document') await moveDocumentBefore(document, target.document);
            }
            toast.success('학습노트 순서를 저장했습니다.');
        } catch (error) {
            console.error('[학습노트] 순서 저장 실패:', error);
            toast.error(error.response?.data?.msg || '순서를 저장하지 못했습니다.');
        }
    };

    const handleTreeDragStart = (event, item) => {
        if (scope !== STUDY_SCOPE_MINE) return;
        setDraggedTreeItem(item);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `${item.type}:${item.id}`);
    };

    const handleTreeDragOver = (event, targetKey) => {
        if (!draggedTreeItem || scope !== STUDY_SCOPE_MINE) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTargetKey(targetKey);
    };

    const handleTreeDragEnd = () => {
        setDraggedTreeItem(null);
        setDropTargetKey('');
    };

    const handleDownloadDocument = () => {
        const title = editorState.title || '학습노트';
        const body = String(editorState.content || '').trim();
        const metadata = [
            `# ${title}`,
            '',
            `- 작성자: ${editorState.ownerId || userId}`,
            `- 공개 범위: ${editorState.visibility === 'public' ? '전체공개' : '나만공개'}`,
            editorState.updatedAt ? `- 최근 수정: ${editorState.updatedAt}` : '',
        ].filter(Boolean).join('\n');
        const downloadText = `${metadata}\n\n${body || '내용 없음'}\n`;
        const blob = new Blob([downloadText], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${sanitizeStudyDownloadFileName(title)}.md`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast.success('문서를 다운로드했습니다.');
    };

    const handleCopyShareLink = async () => {
        if (!canShareCurrentDocument) {
            toast.info('전체공개 문서만 공유할 수 있습니다.');
            return;
        }

        const shareUrl = new URL('/study', window.location.origin);
        shareUrl.searchParams.set('scope', 'public');
        shareUrl.searchParams.set('doc', String(editorState.id));

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl.toString());
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = shareUrl.toString();
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            toast.success('공유 링크를 복사했습니다.');
        } catch (error) {
            console.error('[학습노트] 공유 링크 복사 실패:', error);
            toast.error('공유 링크를 복사하지 못했습니다.');
        }
    };

    const handleEditorChange = useCallback((nextContent, nextContentJson) => {
        setEditorState((previous) => ({
            ...previous,
            content: nextContent,
            contentJson: nextContentJson,
        }));

        if (contentHasWrongNoteCommand(nextContent) && commandOpenRef.current !== nextContent) {
            commandOpenRef.current = nextContent;
            setWrongModalOpen(true);
        }
        if (!contentHasWrongNoteCommand(nextContent)) {
            commandOpenRef.current = '';
        }
    }, []);

    const loadWrongNotes = useCallback(async () => {
        if (!loggedIn) return;
        setLoadingWrongs(true);
        try {
            const response = await axios.get(`${API_BASE}/api/study/wrong-notes`, {
                params: { ...getAuthParams(), kind: wrongKind },
            });
            setWrongNotes(response.data.wrongNotes || []);
            setSelectedWrongIds(new Set());
        } catch (error) {
            console.error('[학습노트] 오답 조회 실패:', error);
            toast.error(error.response?.data?.msg || '오답노트를 불러오지 못했습니다.');
        } finally {
            setLoadingWrongs(false);
        }
    }, [loggedIn, wrongKind]);

    useEffect(() => {
        if (wrongModalOpen) loadWrongNotes();
    }, [wrongModalOpen, loadWrongNotes]);

    const toggleWrongSelection = (sourceId) => {
        setSelectedWrongIds((previous) => {
            const next = new Set(previous);
            if (next.has(sourceId)) next.delete(sourceId);
            else next.add(sourceId);
            return next;
        });
    };

    const handleInsertWrongNotes = () => {
        if (selectedWrongNotes.length === 0) {
            toast.info('삽입할 오답을 선택해주세요.');
            return;
        }
        const nextDocument = appendWrongNotesToStudyDocument({
            content: editorState.content,
            contentJson: editorState.contentJson,
            wrongNotes: selectedWrongNotes,
        });
        const nextRefs = [
            ...(editorState.wrongRefs || []),
            ...selectedWrongNotes.map((wrong) => ({
                sourceType: wrong.sourceType,
                sourceId: wrong.sourceId,
                source: wrong.source,
                questionId: wrong.questionId,
                roomId: wrong.roomId || null,
            })),
        ];
        setEditorState((previous) => ({
            ...previous,
            ...nextDocument,
            wrongRefs: nextRefs,
            docType: previous.docType === 'note' ? 'wrong-note' : previous.docType,
        }));
        setWrongModalOpen(false);
        setEditorKey((value) => value + 1);
        toast.success('선택한 오답을 문서에 삽입했습니다.');
    };

    const renderTreeRow = ({
        keyValue,
        label,
        depth = 0,
        count = 0,
        icon = 'folder',
        canExpand = true,
        hasBranch = false,
        onSelect,
        itemType = 'folder',
        item = null,
        draggable = false,
        droppable = false,
    }) => {
        const normalizedKey = String(keyValue);
        const isExpanded = isTreeKeyExpanded(normalizedKey);
        const isActive = selectedFolderKey === normalizedKey;
        const IconComponent = icon === 'file' ? FiFileText : FiFolder;
        const dragPayload = itemType === 'folder' && item ? { type: 'folder', id: item.id } : null;

        return (
            <div
                key={normalizedKey}
                role="treeitem"
                aria-expanded={canExpand ? isExpanded : undefined}
                className={`wgs-study-folder-item wgs-study-tree-row ${isActive ? 'is-active' : ''} ${hasBranch ? 'has-branch' : ''} ${dropTargetKey === normalizedKey ? 'is-drop-target' : ''}`}
                style={{ '--tree-depth': depth }}
                draggable={draggable}
                onDragStart={draggable && dragPayload ? (event) => handleTreeDragStart(event, dragPayload) : undefined}
                onDragEnd={handleTreeDragEnd}
                onDragOver={droppable ? (event) => handleTreeDragOver(event, normalizedKey) : undefined}
                onDragLeave={droppable ? () => setDropTargetKey('') : undefined}
                onDrop={droppable ? (event) => handleTreeDrop(event, itemType === 'root' ? { type: 'root' } : { type: 'folder', id: item?.id }) : undefined}
                onContextMenu={itemType === 'folder' && item ? (event) => openTreeContextMenu(event, { type: 'folder', folder: item }) : undefined}
            >
                <button
                    type="button"
                    className={`wgs-study-tree-toggle ${isExpanded ? 'is-expanded' : ''}`}
                    onClick={() => canExpand && toggleTreeKey(normalizedKey)}
                    aria-label={`${label} ${isExpanded ? '접기' : '펼치기'}`}
                    disabled={!canExpand}
                >
                    <FiChevronRight className="wgs-study-tree-chevron" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="wgs-study-tree-select"
                    onClick={onSelect}
                >
                    <IconComponent className={`wgs-study-tree-icon ${icon === 'file' ? 'is-file' : ''}`} aria-hidden="true" />
                    <span className="wgs-study-tree-main">
                        <span className="wgs-study-tree-label">{label}</span>
                        <span className="wgs-study-tree-meta">{count}개</span>
                    </span>
                </button>
            </div>
        );
    };

    const renderDocumentTreeLeaf = (document, depth) => (
        <div
            key={`doc-${document.id}`}
            role="treeitem"
            className={`wgs-study-folder-item wgs-study-tree-row wgs-study-tree-file-row has-branch ${String(selectedDocumentId) === String(document.id) ? 'is-active' : ''} ${dropTargetKey === `doc-${document.id}` ? 'is-drop-target' : ''}`}
            style={{ '--tree-depth': depth }}
            draggable={scope === STUDY_SCOPE_MINE}
            onDragStart={(event) => handleTreeDragStart(event, { type: 'document', id: document.id })}
            onDragEnd={handleTreeDragEnd}
            onDragOver={(event) => handleTreeDragOver(event, `doc-${document.id}`)}
            onDragLeave={() => setDropTargetKey('')}
            onDrop={(event) => handleTreeDrop(event, { type: 'document', id: document.id, document })}
            onContextMenu={(event) => openTreeContextMenu(event, { type: 'document', document })}
        >
            <span className="wgs-study-tree-toggle is-placeholder" aria-hidden="true" />
            <button
                type="button"
                className="wgs-study-tree-select"
                onClick={() => loadDocument(document.id)}
            >
                <FiFileText className="wgs-study-tree-icon is-file" aria-hidden="true" />
                <span className="wgs-study-tree-main">
                    <span className="wgs-study-tree-label">{document.title}</span>
                    <span className="wgs-study-tree-meta">{document.visibility === 'public' ? '전체공개' : '나만공개'}</span>
                </span>
            </button>
        </div>
    );

    if (!loggedIn) {
        return (
            <div className="wgs-study-page">
                <div className="wgs-study-empty">
                    학습노트는 로그인 후 사용할 수 있습니다.
                </div>
            </div>
        );
    }

    return (
        <div className="wgs-study-page">
            <header className="wgs-study-header">
                <div>
                    <p className="wgs-study-eyebrow">개인 학습 공간</p>
                    <h1>학습노트</h1>
                    <p>시험 정리, 오답 복습, 공개 공유를 한 화면에서 관리합니다.</p>
                </div>
                <div className="wgs-study-header-actions">
                    <button type="button" className="wgs-study-button" onClick={() => loadTree(scope)} disabled={loadingTree}>
                        <FiRefreshCw aria-hidden="true" /> 새로고침
                    </button>
                    <button type="button" className="wgs-study-button primary" onClick={handleNewDocument}>
                        <FiFilePlus aria-hidden="true" /> 새 문서
                    </button>
                </div>
            </header>

            <div className="wgs-study-layout">
                <aside className="wgs-study-panel">
                    <div className="wgs-study-scope-tabs" role="tablist" aria-label="학습노트 범위">
                        <button
                            type="button"
                            className={`wgs-study-tab ${scope === STUDY_SCOPE_MINE ? 'is-active' : ''}`}
                            onClick={() => handleScopeChange(STUDY_SCOPE_MINE)}
                        >
                            내 학습노트
                        </button>
                        <button
                            type="button"
                            className={`wgs-study-tab ${scope === STUDY_SCOPE_PUBLIC ? 'is-active' : ''}`}
                            onClick={() => handleScopeChange(STUDY_SCOPE_PUBLIC)}
                        >
                            전체공개
                        </button>
                    </div>

                    {scope === STUDY_SCOPE_MINE && (
                        <>
                            <div className="wgs-study-folder-form">
                                <input
                                    className="wgs-study-input"
                                    value={folderName}
                                    onChange={(event) => setFolderName(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') handleCreateFolder();
                                    }}
                                    placeholder="폴더 이름"
                                />
                                <button
                                    type="button"
                                    className="wgs-study-button primary wgs-study-folder-create-button"
                                    onClick={handleCreateFolder}
                                    aria-label="폴더 추가"
                                    title="폴더 추가"
                                >
                                    추가
                                </button>
                            </div>

                            <div className="wgs-study-tree" role="tree" aria-label="학습노트 폴더 트리">
                                {renderTreeRow({
                                    keyValue: STUDY_ROOT_FOLDER,
                                    label: '루트',
                                    count: documentCountByFolderKey.get(STUDY_ROOT_FOLDER) || 0,
                                    canExpand: Boolean(documents.length || flatFolders.length),
                                    itemType: 'root',
                                    droppable: true,
                                    onSelect: () => handleSelectFolder(STUDY_ROOT_FOLDER),
                                })}
                                {isTreeKeyExpanded(STUDY_ROOT_FOLDER) && renderTreeRow({
                                    keyValue: 'all',
                                    label: '전체 문서',
                                    depth: 1,
                                    count: documents.length,
                                    icon: 'file',
                                    canExpand: false,
                                    hasBranch: true,
                                    onSelect: () => handleSelectFolder('all'),
                                })}
                                {isTreeKeyExpanded(STUDY_ROOT_FOLDER) && (
                                    documentsByFolderKey.get(STUDY_ROOT_FOLDER) || []
                                ).map((document) => renderDocumentTreeLeaf(document, 1))}
                                {visibleFolders.map((folder) => {
                                    const folderKey = String(folder.id);
                                    const childRows = [renderTreeRow({
                                        keyValue: folderKey,
                                        label: folder.name,
                                        depth: folder.depth + 1,
                                        count: documentCountByFolderKey.get(folderKey) || 0,
                                        canExpand: Boolean((childFolderCountByParentKey.get(folderKey) || 0) || (documentCountByFolderKey.get(folderKey) || 0)),
                                        hasBranch: true,
                                        itemType: 'folder',
                                        item: folder,
                                        draggable: true,
                                        droppable: true,
                                        onSelect: () => handleSelectFolder(folderKey),
                                    })];
                                    if (isTreeKeyExpanded(folderKey)) {
                                        (documentsByFolderKey.get(folderKey) || []).forEach((document) => {
                                            childRows.push(renderDocumentTreeLeaf(document, folder.depth + 2));
                                        });
                                    }
                                    return childRows;
                                })}
                            </div>

                            <button
                                type="button"
                                className="wgs-study-button danger"
                                onClick={handleDeleteFolder}
                                disabled={!selectedFolderId}
                            >
                                <FiTrash2 aria-hidden="true" /> 폴더 삭제
                            </button>
                        </>
                    )}

                    <StudyDocumentList
                        documents={filteredDocuments}
                        selectedDocumentId={selectedDocumentId}
                        loading={loadingTree}
                        searchTerm={searchTerm}
                        topMargin={scope === STUDY_SCOPE_MINE ? 18 : 0}
                        onSearchChange={setSearchTerm}
                        onSelectDocument={loadDocument}
                        getDocumentFolderName={getDocumentFolderName}
                    />
                </aside>

                <section className={`wgs-study-editor ${canEditCurrentDocument ? '' : 'is-readonly'}`}>
                    <div className="wgs-study-editor-title">
                        <h2>{editorHeading}</h2>
                        <div className="wgs-study-editor-actions">
                            <div className="wgs-study-action-group">
                                {canEditCurrentDocument && (
                                    <button
                                        type="button"
                                        className="wgs-study-button"
                                        onClick={() => setWrongModalOpen(true)}
                                    >
                                        <FiBookOpen aria-hidden="true" /> 오답노트
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="wgs-study-button"
                                    onClick={handleDownloadDocument}
                                    disabled={!editorState.title && !editorState.content}
                                >
                                    <FiDownload aria-hidden="true" /> 다운로드
                                </button>
                                {canShareCurrentDocument && (
                                    <button
                                        type="button"
                                        className="wgs-study-button"
                                        onClick={handleCopyShareLink}
                                    >
                                        <FiShare2 aria-hidden="true" /> 공유
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="wgs-study-button"
                                    onClick={openDraftModal}
                                    disabled={!loggedIn}
                                >
                                    <FiArchive aria-hidden="true" /> 임시목록
                                </button>
                            </div>
                            {canEditCurrentDocument && (
                                <div className="wgs-study-action-group is-primary">
                                    <button
                                        type="button"
                                        className="wgs-study-button"
                                        onClick={handleSaveDraft}
                                        disabled={savingDraft || !canSaveCurrentDraft}
                                    >
                                        <FiClock aria-hidden="true" /> 임시저장
                                    </button>
                                    <button
                                        type="button"
                                        className="wgs-study-button success"
                                        onClick={handleSaveDocument}
                                        disabled={saving}
                                    >
                                        <FiSave aria-hidden="true" /> 저장
                                    </button>
                                    <button
                                        type="button"
                                        className="wgs-study-button danger wgs-study-delete-document-button"
                                        onClick={handleDeleteDocument}
                                        disabled={!editorState.id}
                                        aria-label="문서 삭제"
                                        title="문서 삭제"
                                    >
                                        <FiTrash2 aria-hidden="true" /> 삭제
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {canEditCurrentDocument ? (
                        <div className="wgs-study-editor-grid">
                            <input
                                className="wgs-study-input"
                                value={editorState.title}
                                onChange={(event) => setEditorState((previous) => ({ ...previous, title: event.target.value }))}
                                placeholder="문서 제목"
                            />
                            <select
                                className="wgs-study-select"
                                value={editorState.visibility}
                                onChange={(event) => setEditorState((previous) => ({ ...previous, visibility: event.target.value }))}
                            >
                                <option value="private">나만공개</option>
                                <option value="public">전체공개</option>
                            </select>
                            <select
                                className="wgs-study-select"
                                value={editorState.docType}
                                onChange={(event) => setEditorState((previous) => ({ ...previous, docType: event.target.value }))}
                            >
                                <option value="note">일반노트</option>
                                <option value="wrong-note">오답노트</option>
                                <option value="summary">요약정리</option>
                            </select>
                        </div>
                    ) : editorState.id ? (
                        <div className="wgs-study-public-summary">
                            <div>
                                <span>제목</span>
                                <strong>{editorState.title || '제목 없음'}</strong>
                            </div>
                            <div>
                                <span>공개 범위</span>
                                <strong>{editorState.visibility === 'public' ? '전체공개' : '나만공개'}</strong>
                            </div>
                            <div>
                                <span>노트 유형</span>
                                <strong>{editorState.docType === 'wrong-note' ? '오답노트' : editorState.docType === 'summary' ? '요약정리' : '일반노트'}</strong>
                            </div>
                        </div>
                    ) : (
                        <div className="wgs-study-empty">좌측 목록에서 전체공개 문서를 선택해주세요.</div>
                    )}

                    <div className="wgs-study-editor-meta">
                        <span>작성자: {editorState.ownerId || userId}</span>
                        {editorState.updatedAt && <span>최근 수정: {editorState.updatedAt}</span>}
                        {loadingDocument && <span>문서 불러오는 중</span>}
                    </div>

                    {canEditCurrentDocument && (
                        <div className="wgs-study-command-strip">
                            <span>에디터에서 <code>/오답노트</code>를 입력하거나 버튼을 누르면 틀린 문제를 불러옵니다.</span>
                            {lastDraftSavedAt && <strong>임시저장 {lastDraftSavedAt}</strong>}
                        </div>
                    )}

                    <div className="wgs-study-editor-surface">
                        {canEditCurrentDocument ? (
                            <BoardBlockNoteEditor
                                key={editorKey}
                                content={editorState.content}
                                contentJson={editorState.contentJson}
                                editorKey={editorKey}
                                uploadAuth={getAuthParams()}
                                uploadUrl={`${API_BASE}/api/study/upload-file`}
                                onEditorChange={handleEditorChange}
                            />
                        ) : editorState.id ? (
                            <div className="wgs-study-readonly">
                                <BoardContentView content={editorState.content} contentJson={editorState.contentJson} />
                            </div>
                        ) : (
                            <div className="wgs-study-readonly is-empty">
                                표시할 문서가 없습니다.
                            </div>
                        )}
                    </div>
                </section>
            </div>

            <StudyTreeContextMenu
                menu={treeContextMenu}
                onRename={() => handleRenameTreeItem()}
                onOpenDocument={(document) => {
                    setTreeContextMenu(null);
                    loadDocument(document.id);
                }}
            />

            {draftModalOpen && (
                <StudyDraftModal
                    drafts={drafts}
                    draftTotal={draftTotal}
                    draftPage={draftPage}
                    draftTotalPages={draftTotalPages}
                    loadingDrafts={loadingDrafts}
                    onClose={() => setDraftModalOpen(false)}
                    onRefresh={() => loadDrafts(draftPage)}
                    onLoadDraft={handleLoadDraft}
                    onDeleteDraft={handleDeleteDraft}
                    onPageChange={setDraftPage}
                />
            )}

            {wrongModalOpen && (
                <StudyWrongNoteModal
                    wrongKind={wrongKind}
                    wrongSearch={wrongSearch}
                    visibleWrongNotes={visibleWrongNotes}
                    selectedWrongIds={selectedWrongIds}
                    selectedWrongCount={selectedWrongNotes.length}
                    loadingWrongs={loadingWrongs}
                    onClose={() => setWrongModalOpen(false)}
                    onKindChange={setWrongKind}
                    onSearchChange={setWrongSearch}
                    onReload={loadWrongNotes}
                    onToggleWrong={toggleWrongSelection}
                    onInsert={handleInsertWrongNotes}
                />
            )}
        </div>
    );
}

export default StudyNotes;
