import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostBoardType, withBoardMarker, getBoardEditorInitialContent } from './boardUtils.js';

test('notice authority comes only from the server field', () => {
    for (const post of [{ authorName: '관리자' }, { isNotice: 1 }, { content: '[[UGONGSIL_BOARD:NOTICE]]' }, { boardType: 'NOTICE' }]) {
        assert.equal(getPostBoardType(post), 'free');
    }
    assert.equal(getPostBoardType({ boardType: 'notice', content: '[[UGONGSIL_BOARD:FREE]]' }), 'notice');
    assert.equal(getPostBoardType({ boardType: 'free', isNotice: 1, authorName: '관리자' }), 'free');
});

test('legacy display cleanup preserves editor documents without adding authority markers', () => {
    assert.equal(withBoardMarker('본문\n[[UGONGSIL_BOARD:NOTICE]]', 'notice'), '본문');
    const content = [{ type: 'paragraph', content: '기존 내용' }];
    assert.deepEqual(getBoardEditorInitialContent('legacy', JSON.stringify(content)), content);
});
