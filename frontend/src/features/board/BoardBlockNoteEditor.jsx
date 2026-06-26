import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './boardBlockNote.css';
import { getBoardEditorInitialContent } from './boardUtils';
import { boardBlockNoteDictionary } from './boardBlockNoteDictionary';

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsDataURL(file);
});

function BoardBlockNoteEditor({
    content,
    contentJson,
    editorKey,
    uploadAuth,
    uploadUrl,
    onEditorChange,
}) {
    const uploadAuthRef = useRef(uploadAuth || {});

    useEffect(() => {
        uploadAuthRef.current = uploadAuth || {};
    }, [uploadAuth]);

    const initialContent = useMemo(
        () => getBoardEditorInitialContent(content, contentJson),
        [content, contentJson]
    );

    const uploadFile = useCallback(async (file) => {
        const dataUrl = await fileToDataUrl(file);
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                ...(uploadAuthRef.current || {}),
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                dataUrl,
            }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) {
            throw new Error(result.msg || '파일 업로드에 실패했습니다.');
        }

        return result.url;
    }, [uploadUrl]);

    const editor = useCreateBlockNote({
        initialContent,
        uploadFile,
        dictionary: boardBlockNoteDictionary,
    }, [editorKey, uploadUrl]);

    const handleChange = useCallback((nextEditor) => {
        const blocks = nextEditor.document;
        const nextContentJson = JSON.stringify(blocks);
        const nextContent = nextEditor.blocksToMarkdownLossy(blocks).trim();
        onEditorChange(nextContent, nextContentJson);
    }, [onEditorChange]);

    return (
        <div className="wgs-board-blocknote-shell">
            <BlockNoteView
                editor={editor}
                theme="light"
                onChange={handleChange}
            />
        </div>
    );
}

export default BoardBlockNoteEditor;
