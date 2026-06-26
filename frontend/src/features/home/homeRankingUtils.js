// 필기 기출은 questions 테이블 기준, 실기 기출은 ipep_exam_catalog 기준으로 가져옵니다.
// 새 회차를 DB에 추가하면 홈 랭킹 필터도 자동으로 확장됩니다.
export const normalizeExamCatalogList = (rawCatalog = []) => {
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

export const getHomeRankingLabel = (rankingTab, labels) => {
    if (rankingTab === 'random') return labels.random;
    if (rankingTab === 'past') return labels.past;
    if (rankingTab === 'ipep_random') return labels.ipepRandom;
    return labels.ipepPast;
};
