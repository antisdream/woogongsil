function StudyTreeContextMenu({ menu, onRename, onOpenDocument }) {
    if (!menu) return null;

    return (
        <div
            className="wgs-study-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
        >
            <button type="button" onClick={onRename} role="menuitem">
                {menu.type === 'folder' ? '폴더명 변경' : '문서명 변경'}
            </button>
            {menu.type === 'document' && (
                <button
                    type="button"
                    onClick={() => onOpenDocument(menu.document)}
                    role="menuitem"
                >
                    문서 열기
                </button>
            )}
        </div>
    );
}

export default StudyTreeContextMenu;
