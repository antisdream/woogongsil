import React from 'react';
import { attachedFiles } from './useUploadResolver.js';

export default function AttachmentDownloads({ contentJson, downloadFile, fileError }) {
    const files = attachedFiles(contentJson);
    return <>
        {fileError && <p role="alert" className="board-attachment-error">{fileError}</p>}
        {files.length > 0 && <ul className="board-attachment-downloads" aria-label="첨부파일 다운로드">
            {files.map(file => <li key={file.url}><button type="button" className="board-button" onClick={() => downloadFile(file)}>{file.name} 다운로드</button></li>)}
        </ul>}
    </>;
}
