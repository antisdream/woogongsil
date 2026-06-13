// 카카오 장소 검색과 좌표 변환 호출을 감쌉니다.
'use strict';

const https = require('https');

function mealmapKakaoMapJsKey() {
    return String(
        process.env.KAKAO_MAP_JS_KEY ||
        process.env.KAKAO_MAP_JAVASCRIPT_KEY ||
        process.env.KAKAO_JAVASCRIPT_KEY ||
        process.env.VITE_KAKAO_MAP_JS_KEY ||
        ''
    ).trim();
}

function mealmapKakaoRestKey() {
    return String(
        process.env.KAKAO_REST_API_KEY ||
        process.env.KAKAO_LOCAL_REST_API_KEY ||
        ''
    ).trim();
}

function mealmapHttpsJson(hostname, requestPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname,
            path: requestPath,
            method: 'GET',
            headers,
            timeout: 6000,
        }, (apiRes) => {
            let raw = '';
            apiRes.on('data', (chunk) => { raw += chunk; });
            apiRes.on('end', () => {
                let parsed = {};
                try {
                    parsed = raw ? JSON.parse(raw) : {};
                } catch (parseError) {
                    return reject(parseError);
                }
                resolve({ statusCode: apiRes.statusCode || 0, data: parsed });
            });
        });
        request.on('timeout', () => {
            request.destroy(new Error('Kakao API response timed out.'));
        });
        request.on('error', reject);
        request.end();
    });
}

module.exports = {
    mealmapKakaoMapJsKey,
    mealmapKakaoRestKey,
    mealmapHttpsJson,
};
