import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import {
    FiBookOpen,
    FiChevronRight,
    FiFilePlus,
    FiFileText,
    FiFolder,
    FiFolderPlus,
    FiRefreshCw,
    FiSave,
    FiSearch,
    FiTrash2,
    FiX,
} from 'react-icons/fi';
import BoardBlockNoteEditor from '../features/board/BoardBlockNoteEditor.jsx';
import BoardContentView from '../features/board/BoardContentView.jsx';
import {
    STUDY_ROOT_FOLDER,
    STUDY_SCOPE_MINE,
    STUDY_SCOPE_PUBLIC,
    appendWrongNotesToStudyDocument,
    contentHasWrongNoteCommand,
    flattenStudyFolders,
    getStudyAuthPayload,
    isStudyLoggedIn,
    normalizeStudyFolderKey,
} from '../features/study/studyNoteUtils.js';
import '../features/study/studyNotes.css';

const API_BASE = '';

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

    const [scope, setScope] = useState(STUDY_SCOPE_MINE);
    const [folders, setFolders] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [selectedFolderKey, setSelectedFolderKey] = useState(STUDY_ROOT_FOLDER);
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

    const loadDocument = useCallback(async (documentId) => {
        if (!documentId || !loggedIn) return;
        setLoadingDocument(true);
        try {
            const response = await axios.get(`${API_BASE}/api/study/documents/${documentId}`, {
                params: getAuthParams(),
            });
            const document = response.data.document || {};
            setSelectedDocumentId(document.id);
            setEditorState({
                ...emptyEditorState,
                ...document,
                folderId: document.folderId || null,
                visibility: document.visibility || 'private',
                docType: document.docType || 'note',
                wrongRefs: document.wrongRefs || [],
            });
            setEditorKey((value) => value + 1);
        } catch (error) {
            console.error('[학습노트] 문서 조회 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 불러오지 못했습니다.');
        } finally {
            setLoadingDocument(false);
        }
    }, [loggedIn]);

    useEffect(() => {
        loadTree(scope);
    }, [loadTree, scope]);

    const handleScopeChange = (nextScope) => {
        setScope(nextScope);
        setSelectedFolderKey(nextScope === STUDY_SCOPE_PUBLIC ? 'all' : STUDY_ROOT_FOLDER);
        setSelectedDocumentId(null);
        setEditorState(emptyEditorState);
        setEditorKey((value) => value + 1);
    };

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
            await axios.post(`${API_BASE}/api/study/folders`, {
                ...getAuthParams(),
                parentId: selectedFolderId,
                name,
            });
            setExpandedTreeKeys((previous) => new Set([
                ...previous,
                STUDY_ROOT_FOLDER,
                selectedFolderKey,
            ]));
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
        setSelectedDocumentId('new');
        setEditorState({
            ...emptyEditorState,
            folderId: selectedFolderId,
            ownerId: userId,
            title: '새 학습노트',
        });
        setEditorKey((value) => value + 1);
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
            setSelectedDocumentId(savedDocument.id);
            setEditorState((previous) => ({
                ...previous,
                ...savedDocument,
                wrongRefs: previous.wrongRefs || [],
            }));
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('문서를 저장했습니다.');
        } catch (error) {
            console.error('[학습노트] 문서 저장 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 저장하지 못했습니다.');
        } finally {
            setSaving(false);
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
            setEditorKey((value) => value + 1);
            await loadTree(STUDY_SCOPE_MINE);
            toast.success('문서를 삭제했습니다.');
        } catch (error) {
            console.error('[학습노트] 문서 삭제 실패:', error);
            toast.error(error.response?.data?.msg || '문서를 삭제하지 못했습니다.');
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
    }) => {
        const normalizedKey = String(keyValue);
        const isExpanded = isTreeKeyExpanded(normalizedKey);
        const isActive = selectedFolderKey === normalizedKey;
        const IconComponent = icon === 'file' ? FiFileText : FiFolder;

        return (
            <div
                key={normalizedKey}
                role="treeitem"
                aria-expanded={canExpand ? isExpanded : undefined}
                className={`wgs-study-folder-item wgs-study-tree-row ${isActive ? 'is-active' : ''} ${hasBranch ? 'has-branch' : ''}`}
                style={{ '--tree-depth': depth }}
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
            className={`wgs-study-folder-item wgs-study-tree-row wgs-study-tree-file-row has-branch ${String(selectedDocumentId) === String(document.id) ? 'is-active' : ''}`}
            style={{ '--tree-depth': depth }}
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
                                    className="wgs-study-icon-button wgs-study-folder-create-button"
                                    onClick={handleCreateFolder}
                                    aria-label="폴더 만들기"
                                    title="폴더 만들기"
                                >
                                    <FiFolderPlus aria-hidden="true" />
                                </button>
                            </div>

                            <div className="wgs-study-tree" role="tree" aria-label="학습노트 폴더 트리">
                                {renderTreeRow({
                                    keyValue: STUDY_ROOT_FOLDER,
                                    label: '루트',
                                    count: documentCountByFolderKey.get(STUDY_ROOT_FOLDER) || 0,
                                    canExpand: Boolean(documents.length || flatFolders.length),
                                    onSelect: () => setSelectedFolderKey(STUDY_ROOT_FOLDER),
                                })}
                                {isTreeKeyExpanded(STUDY_ROOT_FOLDER) && renderTreeRow({
                                    keyValue: 'all',
                                    label: '전체 문서',
                                    depth: 1,
                                    count: documents.length,
                                    icon: 'file',
                                    canExpand: false,
                                    hasBranch: true,
                                    onSelect: () => setSelectedFolderKey('all'),
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
                                        onSelect: () => setSelectedFolderKey(folderKey),
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

                    <div className="wgs-study-panel-title" style={{ marginTop: scope === STUDY_SCOPE_MINE ? 18 : 0 }}>
                        <h2>문서</h2>
                        <span>{filteredDocuments.length}개</span>
                    </div>
                    <label className="wgs-study-search">
                        <FiSearch aria-hidden="true" />{' '}
                        <input
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="문서 검색"
                            style={{ border: 0, outline: 0, width: 'calc(100% - 24px)', font: 'inherit' }}
                        />
                    </label>
                    <div className="wgs-study-doc-list wgs-study-document-tree" style={{ marginTop: 12 }}>
                        {filteredDocuments.map((document) => (
                            <button
                                key={document.id}
                                type="button"
                                className={`wgs-study-doc-item wgs-study-document-item ${String(selectedDocumentId) === String(document.id) ? 'is-active' : ''}`}
                                onClick={() => loadDocument(document.id)}
                            >
                                <FiFileText className="wgs-study-doc-icon" aria-hidden="true" />
                                <span className="wgs-study-doc-content">
                                    <strong>{document.title}</strong>
                                    <span className="wgs-study-doc-meta">{getDocumentFolderName(document.folderId)} · {document.visibility === 'public' ? '전체공개' : '나만공개'} · {document.updatedAt || document.createdAt || ''}</span>
                                </span>
                            </button>
                        ))}
                        {!filteredDocuments.length && (
                            <div className="wgs-study-empty">
                                {loadingTree ? '문서 목록을 불러오는 중입니다.' : '표시할 문서가 없습니다.'}
                            </div>
                        )}
                    </div>
                </aside>

                <section className="wgs-study-editor">
                    <div className="wgs-study-editor-title">
                        <h2>{editorState.id ? '문서 편집' : '새 문서'}</h2>
                        <div className="wgs-study-editor-actions">
                            <button
                                type="button"
                                className="wgs-study-button"
                                onClick={() => setWrongModalOpen(true)}
                                disabled={!canEditCurrentDocument}
                            >
                                <FiBookOpen aria-hidden="true" /> 오답노트 삽입
                            </button>
                            <button
                                type="button"
                                className="wgs-study-button success"
                                onClick={handleSaveDocument}
                                disabled={!canEditCurrentDocument || saving}
                            >
                                <FiSave aria-hidden="true" /> 저장
                            </button>
                            <button
                                type="button"
                                className="wgs-study-icon-button"
                                onClick={handleDeleteDocument}
                                disabled={!editorState.id || !canEditCurrentDocument}
                                title="문서 삭제"
                            >
                                <FiTrash2 aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    <div className="wgs-study-editor-grid">
                        <input
                            className="wgs-study-input"
                            value={editorState.title}
                            onChange={(event) => setEditorState((previous) => ({ ...previous, title: event.target.value }))}
                            placeholder="문서 제목"
                            disabled={!canEditCurrentDocument}
                        />
                        <select
                            className="wgs-study-select"
                            value={editorState.visibility}
                            onChange={(event) => setEditorState((previous) => ({ ...previous, visibility: event.target.value }))}
                            disabled={!canEditCurrentDocument}
                        >
                            <option value="private">나만공개</option>
                            <option value="public">전체공개</option>
                        </select>
                        <select
                            className="wgs-study-select"
                            value={editorState.docType}
                            onChange={(event) => setEditorState((previous) => ({ ...previous, docType: event.target.value }))}
                            disabled={!canEditCurrentDocument}
                        >
                            <option value="note">일반노트</option>
                            <option value="wrong-note">오답노트</option>
                            <option value="summary">요약정리</option>
                        </select>
                    </div>

                    <div className="wgs-study-editor-meta">
                        <span>작성자: {editorState.ownerId || userId}</span>
                        {editorState.updatedAt && <span>최근 수정: {editorState.updatedAt}</span>}
                        {loadingDocument && <span>문서 불러오는 중</span>}
                    </div>

                    {canEditCurrentDocument && (
                        <div className="wgs-study-command-strip">
                            <span>에디터에서 <code>/오답노트</code>를 입력하거나 버튼을 누르면 틀린 문제를 불러옵니다.</span>
                            <button type="button" className="wgs-study-button warn" onClick={() => setWrongModalOpen(true)}>
                                <FiBookOpen aria-hidden="true" /> 불러오기
                            </button>
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
                        ) : (
                            <div className="wgs-study-readonly">
                                <BoardContentView content={editorState.content} contentJson={editorState.contentJson} />
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {wrongModalOpen && (
                <div className="wgs-study-modal-backdrop" role="dialog" aria-modal="true" aria-label="오답노트 삽입">
                    <div className="wgs-study-modal">
                        <div className="wgs-study-modal-header">
                            <div>
                                <h2>오답노트 가져오기</h2>
                                <p>필기, 실기, 3주 공략, 멀티플레이 오답을 선택해서 현재 문서에 삽입합니다.</p>
                            </div>
                            <button type="button" className="wgs-study-icon-button" onClick={() => setWrongModalOpen(false)} title="닫기">
                                <FiX aria-hidden="true" />
                            </button>
                        </div>
                        <div className="wgs-study-modal-body">
                            <div className="wgs-study-wrong-filters">
                                <select
                                    className="wgs-study-select"
                                    value={wrongKind}
                                    onChange={(event) => setWrongKind(event.target.value)}
                                >
                                    <option value="all">전체 오답</option>
                                    <option value="written">필기</option>
                                    <option value="ipep">실기</option>
                                    <option value="ipep_three_week">3주 공략</option>
                                    <option value="multiplayer">멀티플레이</option>
                                </select>
                                <input
                                    className="wgs-study-input"
                                    value={wrongSearch}
                                    onChange={(event) => setWrongSearch(event.target.value)}
                                    placeholder="문제, 정답, 해설 검색"
                                />
                            </div>
                            <div className="wgs-study-toolbar" style={{ marginBottom: 12 }}>
                                <button type="button" className="wgs-study-button" onClick={loadWrongNotes} disabled={loadingWrongs}>
                                    <FiRefreshCw aria-hidden="true" /> 다시 불러오기
                                </button>
                                <span>선택 {selectedWrongNotes.length}개 / 표시 {visibleWrongNotes.length}개</span>
                            </div>
                            <div className="wgs-study-wrong-list">
                                {visibleWrongNotes.map((wrong) => (
                                    <label key={wrong.sourceId} className="wgs-study-wrong-card">
                                        <input
                                            type="checkbox"
                                            checked={selectedWrongIds.has(wrong.sourceId)}
                                            onChange={() => toggleWrongSelection(wrong.sourceId)}
                                        />
                                        <span>
                                            <strong>{wrong.sourceTitle || wrong.sourceLabel || wrong.source}</strong>
                                            {wrong.sourceDetail && wrong.sourceDetail !== wrong.sourceTitle && (
                                                <p>{wrong.sourceDetail}</p>
                                            )}
                                            <p>{wrong.questionText || '문제 지문을 불러오지 못했습니다.'}</p>
                                            <p>내 답: {wrong.userAnswer || '기록 없음'} / 정답: {wrong.correctAnswer || '정답 정보 없음'}</p>
                                        </span>
                                    </label>
                                ))}
                                {!visibleWrongNotes.length && (
                                    <div className="wgs-study-empty">
                                        {loadingWrongs ? '오답을 불러오는 중입니다.' : '가져올 오답이 없습니다.'}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="wgs-study-modal-footer">
                            <button type="button" className="wgs-study-button" onClick={() => setWrongModalOpen(false)}>
                                취소
                            </button>
                            <button type="button" className="wgs-study-button primary" onClick={handleInsertWrongNotes}>
                                선택 삽입
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default StudyNotes;
