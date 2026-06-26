'use strict';

// 2. 시간/날짜 헬퍼 함수

// 오답노트, 로그인 기록처럼 SQL DATETIME에 넣을 때 쓰는 KST 시간.
function getKSTDateTime() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().replace('T', ' ').slice(0, 19);
}

// 게시판 날짜는 기존 JSON의 문자열 모양을 깨뜨리면 안 돼.
// 예: 2026. 4. 29. AM 9:26:22
function getBoardDateString() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
    const dayPeriod = String(parts.dayPeriod || 'AM').toUpperCase();

    return `${parts.year}. ${Number(parts.month)}. ${Number(parts.day)}. ${dayPeriod} ${Number(parts.hour)}:${parts.minute}:${parts.second}`;
}

// MySQL DATE 타입을 프론트가 쓰기 쉬운 YYYY-MM-DD 문자열로 변환해.
function formatDateOnly(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        if (value.includes('T')) return value.slice(0, 10);
        return value.slice(0, 10);
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return String(value).slice(0, 10);
}

// JSON에 저장된 ISO 시간, MySQL 시간, 기존 한국식 문자열을 SQL DATETIME 문자열로 최대한 안전하게 바꿔.
function normalizeToMysqlDateTime(value) {
    if (!value) return getKSTDateTime();

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
        return kst.toISOString().replace('T', ' ').slice(0, 19);
    }

    const text = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;

    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) {
            const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
            return kst.toISOString().replace('T', ' ').slice(0, 19);
        }
    }

    const legacyMatch = text.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(AM|PM|오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})$/i);
    if (legacyMatch) {
        let [, year, month, day, period, hour, minute, second] = legacyMatch;
        let h = Number(hour);
        const upperPeriod = period.toUpperCase();

        if ((upperPeriod === 'PM' || period === '오후') && h < 12) h += 12;
        if ((upperPeriod === 'AM' || period === '오전') && h === 12) h = 0;

        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(h).padStart(2, '0')}:${minute}:${second}`;
    }

    return getKSTDateTime();
}

// 랭킹 24시간 날짜 계산 유틸
// - 기준: 서버 기준 시간
// - 운영 시간: 00:00:00 ~ 23:59:59, 프리시즌 없이 항상 랭킹 반영
// - 날짜 포맷은 기존 DB/JSON 파일과 호환되도록 2026-5-10 형태를 유지합니다.
// - 함수명(getSeasonStatus)은 기존 호출부 호환을 위해 유지하지만,
//  이제 season 개념은 쓰지 않고 하루 단위 daily 랭킹으로만 동작합니다.
function getLocalTimeParts() {
    const now = new Date();
    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds()
    };
}

function getSeasonStatus() {
    const local = getLocalTimeParts();

    return {
        isRegular: true,
        rankingDate: `${local.year}-${local.month}-${local.day}`,
        season: 'daily'
    };
}

module.exports = {
    getKSTDateTime,
    getBoardDateString,
    formatDateOnly,
    normalizeToMysqlDateTime,
    getSeasonStatus,
};
