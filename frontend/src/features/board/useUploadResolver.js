import { useCallback, useEffect, useRef, useState } from 'react';
import { memberRequestHeaders } from '../memberRequestHeaders.js';

export function localUploadPath(value) {
    try {
        const url = new URL(value, window.location.origin);
        return url.origin === window.location.origin && url.pathname.startsWith('/uploads/') ? url.pathname : null;
    } catch { return null; }
}

export function useUploadResolver() {
    const cache = useRef(new Map());
    const objectUrls = useRef(new Set());
    const controllers = useRef(new Set());
    const [fileError, setFileError] = useState('');

    useEffect(() => {
        const urls = objectUrls.current, pending = controllers.current, files = cache.current;
        return () => { for (const controller of pending) controller.abort(); for (const url of urls) URL.revokeObjectURL(url); files.clear(); };
    }, []);

    const resolveFileUrl = useCallback(async value => {
        const uploadPath = localUploadPath(value);
        if (!uploadPath) return value;
        if (!cache.current.has(uploadPath)) {
            const controller = new AbortController(); controllers.current.add(controller);
            cache.current.set(uploadPath, (async () => {
                try {
                    const response = await fetch(uploadPath, { headers: memberRequestHeaders(), credentials: 'include', cache: 'no-store', signal: controller.signal });
                    if (!response.ok) throw new Error('첨부파일을 열 권한이 없거나 파일이 삭제되었습니다. 로그인 상태를 확인해주세요.');
                    const blob = await response.blob();
                    if (controller.signal.aborted) return '';
                    const url = URL.createObjectURL(blob); objectUrls.current.add(url); return url;
                } catch (error) {
                    if (error.name !== 'AbortError') setFileError(error.message);
                    cache.current.delete(uploadPath);
                    return '';
                } finally { controllers.current.delete(controller); }
            })());
        }
        return cache.current.get(uploadPath);
    }, []);

    const downloadFile = useCallback(async file => {
        const url = await resolveFileUrl(file.url); if (!url) return;
        const link = document.createElement('a'); link.href = url; link.download = file.name || '첨부파일';
        link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
    }, [resolveFileUrl]);

    return { resolveFileUrl, downloadFile, fileError };
}

export function attachedFiles(contentJson) {
    let document;
    try { document = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson; } catch { return []; }
    const files = new Map();
    const visit = blocks => {
        if (!Array.isArray(blocks)) return;
        for (const block of blocks) {
            if (localUploadPath(block.props?.url)) files.set(block.props.url, { url: block.props.url, name: block.props.name || '첨부파일' });
            visit(block.children);
        }
    };
    visit(document); return [...files.values()];
}
