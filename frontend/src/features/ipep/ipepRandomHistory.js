const IPEP_RANDOM_HISTORY_KEY = 'wgs_ipep_random_history_v1';
const IPEP_RANDOM_ID_LIMIT = 120;
const IPEP_RANDOM_SUBJECT_LIMIT = 2;

function uniqueRecentIpepList(list, nextValue, limit) {
    const normalized = String(nextValue ?? '').trim();
    if (!normalized) return Array.isArray(list) ? list.slice(0, limit) : [];
    return [normalized, ...(Array.isArray(list) ? list.filter((item) => String(item) !== normalized) : [])].slice(0, limit);
}

export function readIpepRandomHistory() {
    if (typeof window === 'undefined') return { ids: [], subjects: [] };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(IPEP_RANDOM_HISTORY_KEY) || '{}');
        return {
            ids: Array.isArray(parsed.ids) ? parsed.ids.map(String).filter(Boolean).slice(0, IPEP_RANDOM_ID_LIMIT) : [],
            subjects: Array.isArray(parsed.subjects) ? parsed.subjects.map(String).filter(Boolean).slice(0, IPEP_RANDOM_SUBJECT_LIMIT) : [],
        };
    } catch {
        return { ids: [], subjects: [] };
    }
}

export function rememberIpepRandomQuestion(nextQuestion) {
    if (typeof window === 'undefined' || !nextQuestion) return;
    const history = readIpepRandomHistory();
    const questionId = nextQuestion.questionId || nextQuestion.question_id || nextQuestion.id;
    const subject = nextQuestion.subjectCode || nextQuestion.subject_code;
    const nextHistory = {
        ids: uniqueRecentIpepList(history.ids, questionId, IPEP_RANDOM_ID_LIMIT),
        subjects: uniqueRecentIpepList(history.subjects, subject, IPEP_RANDOM_SUBJECT_LIMIT),
    };
    try {
        window.localStorage.setItem(IPEP_RANDOM_HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
        // localStorage가 막혀도 실기 문제은행은 기존 랜덤 방식으로 계속 동작합니다.
    }
}

export function buildIpepRandomQuery(subjectCode = 'ALL') {
    const history = readIpepRandomHistory();
    const params = new URLSearchParams({ subjectCode });
    if (history.ids.length > 0) params.set('excludeIds', history.ids.join(','));
    if (String(subjectCode).toUpperCase() === 'ALL' && history.subjects.length > 0) {
        params.set('excludeSubjects', history.subjects.join(','));
    }
    return params.toString();
}
