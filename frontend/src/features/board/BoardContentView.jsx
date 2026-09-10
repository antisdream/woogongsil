import { useUploadResolver } from './useUploadResolver.js';
import AttachmentDownloads from './AttachmentDownloads.jsx';
import { useMemo } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './boardBlockNote.css';
import { getBoardEditorInitialContent, parseBoardContentJson, getCleanContent } from './boardUtils';
import { boardBlockNoteDictionary } from './boardBlockNoteDictionary';

function BoardContentView({ content, contentJson }) {
    const { resolveFileUrl, downloadFile, fileError } = useUploadResolver();
    const hasBlockDocument = Boolean(parseBoardContentJson(contentJson));
    const initialContent = useMemo(
        () => getBoardEditorInitialContent(content, contentJson),
        [content, contentJson]
    );

    const editor = useCreateBlockNote({
        initialContent,
        resolveFileUrl,
        dictionary: boardBlockNoteDictionary,
    }, [JSON.stringify(initialContent)]);

    if (!hasBlockDocument) {
        return (
            <div className="wgs-board-plain-view">
                {getCleanContent(content)}
            </div>
        );
    }

    return (
        <div className="wgs-board-blocknote-view">
            <AttachmentDownloads contentJson={contentJson} downloadFile={downloadFile} fileError={fileError} />
            <BlockNoteView
                editor={editor}
                theme="light"
                editable={false}
                formattingToolbar={false}
                linkToolbar={false}
                slashMenu={false}
                sideMenu={false}
                filePanel={false}
                tableHandles={false}
                emojiPicker={false}
            />
        </div>
    );
}

export default BoardContentView;
