import React from 'react';
import { FiFileText, FiSearch } from 'react-icons/fi';

function StudyDocumentList({
    documents,
    selectedDocumentId,
    loading,
    searchTerm,
    topMargin = 0,
    onSearchChange,
    onSelectDocument,
    getDocumentFolderName,
}) {
    return (
        <>
            <div className="wgs-study-panel-title" style={{ marginTop: topMargin }}>
                <h2>문서</h2>
                <span>{documents.length}개</span>
            </div>
            <label className="wgs-study-search">
                <FiSearch aria-hidden="true" />{' '}
                <input
                    value={searchTerm}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="문서 검색"
                    style={{ border: 0, outline: 0, width: 'calc(100% - 24px)', font: 'inherit' }}
                />
            </label>
            <div className="wgs-study-doc-list wgs-study-document-tree" style={{ marginTop: 12 }}>
                {documents.map((document) => (
                    <button
                        key={document.id}
                        type="button"
                        className={`wgs-study-doc-item wgs-study-document-item ${String(selectedDocumentId) === String(document.id) ? 'is-active' : ''}`}
                        onClick={() => onSelectDocument(document.id)}
                    >
                        <FiFileText className="wgs-study-doc-icon" aria-hidden="true" />
                        <span className="wgs-study-doc-content">
                            <strong>{document.title}</strong>
                            <span className="wgs-study-doc-meta">
                                {getDocumentFolderName(document.folderId)} · {document.visibility === 'public' ? '전체공개' : '나만공개'} · {document.updatedAt || document.createdAt || ''}
                            </span>
                        </span>
                    </button>
                ))}
                {!documents.length && (
                    <div className="wgs-study-empty">
                        {loading ? '문서 목록을 불러오는 중입니다.' : '표시할 문서가 없습니다.'}
                    </div>
                )}
            </div>
        </>
    );
}

export default StudyDocumentList;
