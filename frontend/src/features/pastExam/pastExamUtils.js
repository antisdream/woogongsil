// 필기 기출 연도/회차 카탈로그 정규화 유틸
// ------------------------------------------------------------
// 화면에서 2021~2025, 1~3회차 같은 값을 하드코딩하지 않고,
// 서버 DB에 실제 존재하는 연도/회차만 선택창에 표시하기 위한 함수입니다.
export const normalizeWrittenExamCatalog = (rawCatalog = []) => {
    const map = new Map();

    (Array.isArray(rawCatalog) ? rawCatalog : []).forEach((item) => {
        const year = Number(item?.year);
        const rawSessions = Array.isArray(item?.sessions) ? item.sessions : [item?.session];

        if (!Number.isFinite(year)) return;

        if (!map.has(year)) {
            map.set(year, { year, sessions: [] });
        }

        const entry = map.get(year);
        rawSessions
            .map((session) => Number(session))
            .filter((session) => Number.isFinite(session))
            .forEach((session) => {
                if (!entry.sessions.includes(session)) {
                    entry.sessions.push(session);
                }
            });
    });

    return Array.from(map.values())
        .map((entry) => ({
            ...entry,
            sessions: entry.sessions.sort((a, b) => a - b),
        }))
        .filter((entry) => entry.sessions.length > 0)
        .sort((a, b) => b.year - a.year);
};

export const getSubjectName = (id) => {
    try {
        if (id === undefined || id === null || id === '') return "과목 정보 없음";
        const strId = String(id).trim();
        const lastChar = strId.charAt(strId.length - 1);

        switch (lastChar) {
            case "0": return "1과목 : 소프트웨어 설계";
            case "1": return "2과목 : 소프트웨어 개발";
            case "2": return "3과목 : 데이터베이스 구축";
            case "3": return "4과목 : 프로그래밍 언어 활용";
            case "4": return "5과목 : 정보시스템 구축 관리";
            default: return `과목 : ${strId}`;
        }
    } catch (e) {
        return "과목 정보 없음";
    }
};

// 필기 해설 텍스트 추출 유틸
// ------------------------------------------------------------
// 문제은행/기출/오답노트 API 응답에서 해설 컬럼명이 조금씩 달라도
// 화면과 PDF 출력부가 같은 방식으로 해설을 찾을 수 있도록 통일합니다.
// 기존 채점 로직은 바꾸지 않고, 출력에 필요한 값만 안전하게 읽습니다.
export const getWrittenExplanation = (item) => {
    const raw = item?.explanation_text
        || item?.explanationText
        || item?.explanation
        || item?.answer_explanation
        || item?.answerExplanation
        || '';

    return String(raw || '').trim();
};

// PDF 출력 HTML 문자 이스케이프 유틸
// ------------------------------------------------------------
// 새 창에 문자열을 직접 document.write 할 때 <, >, &, 따옴표 등이
// HTML 태그처럼 해석되는 것을 막아 PDF 출력 깨짐을 방지합니다.
export const escapeHtml = (value) => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

export const replaceSettingTokens = (text, values = {}) => {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
};

// 시험 시작 버튼 클릭 직후 전체화면을 요청합니다.
// 브라우저 정책상 전체화면은 사용자 클릭 이벤트 안에서만 허용되므로 App.jsx가 아니라 시험 시작 함수에서 호출합니다.
export const requestExamFullscreen = () => {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    } catch (error) {
        // 전체화면 요청 실패는 브라우저 정책 차이일 수 있으므로 시험 시작 자체를 막지 않습니다.
        console.warn('필기 기출 전체화면 요청 실패:', error);
    }
};
