import { useUploadResolver } from './useUploadResolver.js';
import AttachmentDownloads from './AttachmentDownloads.jsx';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './boardBlockNote.css';
import { getBoardEditorInitialContent } from './boardUtils';
import { boardBlockNoteDictionary } from './boardBlockNoteDictionary';

const MB = 1024 * 1024;
const UPLOAD_LIMITS = {
    image: 5 * MB,
    file: 20 * MB,
    audio: 30 * MB,
    video: 30 * MB,
};

const getUploadKind = (file) => {
    const mimeType = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();

    if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/.test(name)) return 'image';
    if (mimeType.startsWith('video/') || /\.mp4$/.test(name)) return 'video';
    if (mimeType.startsWith('audio/') || /\.(mp3|wav)$/.test(name)) return 'audio';
    return 'file';
};

const formatUploadSize = (bytes) => `${Math.round((bytes / MB) * 10) / 10}MB`;

const appendUploadAuth = (formData, uploadAuth) => {
    Object.entries(uploadAuth || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        formData.append(key, String(value));
    });
};

function BoardBlockNoteEditor({
    content,
    contentJson,
    editorKey,
    uploadAuth,
    uploadUrl,
    onEditorChange,
}) {
    const { resolveFileUrl, downloadFile, fileError } = useUploadResolver();
    const uploadAuthRef = useRef(uploadAuth || {});

    useEffect(() => {
        uploadAuthRef.current = uploadAuth || {};
    }, [uploadAuth]);

    const initialContent = useMemo(
        () => getBoardEditorInitialContent(content, contentJson),
        [content, contentJson]
    );

    const uploadFile = useCallback(async (file) => {
        if (/\.(svg|svgz)$/i.test(file.name || '') || String(file.type || '').toLowerCase().includes('svg')) {
            throw new Error('SVG는 지원하지 않습니다. PNG·JPG·WebP 이미지로 변환해 올려주세요.');
        }
        const uploadKind = getUploadKind(file);
        const uploadLimit = UPLOAD_LIMITS[uploadKind] || UPLOAD_LIMITS.file;

        if (file.size > uploadLimit) {
            throw new Error(`${uploadKind === 'image' ? '이미지' : uploadKind === 'video' ? '영상' : uploadKind === 'audio' ? '오디오' : '파일'}은 ${formatUploadSize(uploadLimit)} 이하만 업로드할 수 있습니다.`);
        }

        const formData = new FormData();
        appendUploadAuth(formData, uploadAuthRef.current);
        formData.append('fileName', file.name || 'board-file');
        formData.append('mimeType', file.type || 'application/octet-stream');
        formData.append('size', String(file.size || 0));
        formData.append('file', file);

        const response = await fetch(uploadUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'X-User-Id': String(uploadAuthRef.current.userId || uploadAuthRef.current.id || ''),
                'X-Session-Token': String(uploadAuthRef.current.sessionToken || ''),
            },
            body: formData,
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
        resolveFileUrl,
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
            <AttachmentDownloads contentJson={contentJson} downloadFile={downloadFile} fileError={fileError} />
            <BlockNoteView
                editor={editor}
                theme="light"
                onChange={handleChange}
            />
        </div>
    );
}

export default BoardBlockNoteEditor;
