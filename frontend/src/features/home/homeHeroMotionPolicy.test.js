import assert from 'node:assert/strict';
import test from 'node:test';
import { getHomeHeroMotionVariant } from './homeHeroMotionPolicy.js';

const androidBrowser = 'Mozilla/5.0 (Linux; Android 16; SM-F721N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36';
const androidWebView = 'Mozilla/5.0 (Linux; Android 16; SM-F721N; wv) AppleWebKit/537.36 Version/4.0 Chrome/143.0.0.0 Mobile Safari/537.36';

test('the installed Woogongsil WebView gets the learning story', () => {
    assert.equal(getHomeHeroMotionVariant(androidWebView + ' WoogongsilAndroid/0.1'), 'story');
    assert.equal(getHomeHeroMotionVariant(androidWebView + ' WoogongsilAndroid/2.4.7'), 'story');
});

test('a mobile browser and an unrelated WebView keep the web book', () => {
    assert.equal(getHomeHeroMotionVariant(androidBrowser), 'book');
    assert.equal(getHomeHeroMotionVariant(androidWebView), 'book');
    assert.equal(getHomeHeroMotionVariant('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1'), 'book');
});

test('a desktop browser keeps the web book', () => {
    assert.equal(getHomeHeroMotionVariant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36'), 'book');
});

test('missing and malformed app tokens fall back to the web presentation', () => {
    for (const value of [undefined, null, '', {}, 'NotWoogongsilAndroid/0.1', 'WoogongsilAndroid/', 'WoogongsilAndroid/0.1-other']) {
        assert.equal(getHomeHeroMotionVariant(value), 'book');
    }
});
