// 운세와 추천형 보조 API를 제공합니다.
'use strict';

function registerFortuneRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const getUserById = options.getUserById;
    const getKSTDateTime = options.getKSTDateTime;
    const validateRealtimeSession = options.validateRealtimeSession;

    if (!app || typeof app.post !== 'function') {
        throw new Error('registerFortuneRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerFortuneRoutes requires a MySQL pool.');
    }
    if (typeof getUserById !== 'function' || typeof getKSTDateTime !== 'function' || typeof validateRealtimeSession !== 'function') {
        throw new Error('registerFortuneRoutes requires user/date/session helpers.');
    }

    function authUserId(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    async function requireSessionUser(req, res, expectedId = '') {
        const auth = await validateRealtimeSession(req);
        if (!auth.valid) {
            res.status(401).json({
                success: false,
                valid: false,
                reason: auth.reason || 'session_expired',
                msg: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
            });
            return null;
        }

        const requesterId = authUserId(auth);
        const targetId = String(expectedId || requesterId || '').trim();
        if (!requesterId || !targetId || requesterId !== targetId) {
            res.status(403).json({
                success: false,
                valid: false,
                reason: 'forbidden_user_mismatch',
                msg: '본인 계정으로만 처리할 수 있습니다.',
            });
            return null;
        }

        return auth;
    }
// 11. 운세 기록 / 운세 계산 API
// - 기존 JSON server.js의 계산 로직을 유지하고 저장 위치만 SQL로 옮겼습니다.
app.post('/api/user/fortune-history', async (req, res) => {
    const auth = await requireSessionUser(req, res, req.body.id || req.body.userId);
    if (!auth) return;

    const id = authUserId(auth);
    const type = req.body.type || 'unknown';
    const searchData = req.body.searchData || {};

    try {
        const user = await getUserById(id);
        if (!user) return res.status(400).json({ success: false, msg: '사용자 없음' });

        await pool.query(
            'INSERT INTO wgs_fortune_history (userId, time, type, data) VALUES (?, ?, ?, ?)',
            [id, getKSTDateTime(), type, JSON.stringify(searchData)]
        );

        return res.json({ success: true, msg: '운세 기록 저장 완료' });
    } catch (error) {
        console.error('운세 기록 저장 오류:', error);
        return res.status(500).json({ success: false, msg: '운세 기록 저장 중 오류가 발생했습니다.' });
    }
});

function calculateSajuEngine(name, birthdate, birthtime) {
    const isUnknown = !birthtime || birthtime === 'unknown';
    const exactDate = new Date(`${birthdate}T${isUnknown ? '12:00' : birthtime}:00`);

    if (!isUnknown) exactDate.setMinutes(exactDate.getMinutes() - 30);

    const bYear = exactDate.getFullYear();
    const bMonth = exactDate.getMonth() + 1;
    const bDate = exactDate.getDate();
    const bHour = exactDate.getHours();

    let nameHash = 0;
    for (let i = 0; i < name.length; i++) nameHash += name.charCodeAt(i);

    const STEMS = ['갑(甲)', '을(乙)', '병(丙)', '정(丁)', '무(戊)', '기(己)', '경(庚)', '신(辛)', '임(壬)', '계(癸)'];
    const BRANCHES = ['자(子)', '축(丑)', '인(寅)', '묘(卯)', '진(辰)', '사(巳)', '오(午)', '미(未)', '신(申)', '유(酉)', '술(戌)', '해(亥)'];

    const yearStemIdx = (bYear + 6) % 10;
    const yearBranchIdx = (bYear + 8) % 12;
    const monthStemIdx = (yearStemIdx * 2 + bMonth) % 10;
    const monthBranchIdx = (bMonth + 1) % 12;
    const dayHash = bYear * 365 + bMonth * 30 + bDate + nameHash;
    const dayStemIdx = dayHash % 10;
    const dayBranchIdx = dayHash % 12;
    const hourBranchIdx = Math.floor((bHour + 1) / 2) % 12;
    const hourStemIdx = (dayStemIdx * 2 + hourBranchIdx) % 10;

    const saju = {
        year: `${STEMS[yearStemIdx]}${BRANCHES[yearBranchIdx]}`,
        month: `${STEMS[monthStemIdx]}${BRANCHES[monthBranchIdx]}`,
        day: `${STEMS[dayStemIdx]}${BRANCHES[dayBranchIdx]}`,
        hour: isUnknown ? '모름(??)' : `${STEMS[hourStemIdx]}${BRANCHES[hourBranchIdx]}`
    };

    const elementCount = { '목(木)': 0, '화(火)': 0, '토(土)': 0, '금(金)': 0, '수(水)': 0 };

    const getElement = (char) => {
        if ('갑을인묘'.includes(char[0])) return '목(木)';
        if ('병정사오'.includes(char[0])) return '화(火)';
        if ('무기진술축미'.includes(char[0])) return '토(土)';
        if ('경신신유'.includes(char[0])) return '금(金)';
        return '수(水)';
    };

    const chars = [STEMS[yearStemIdx], BRANCHES[yearBranchIdx], STEMS[monthStemIdx], BRANCHES[monthBranchIdx], STEMS[dayStemIdx], BRANCHES[dayBranchIdx]];
    if (!isUnknown) chars.push(STEMS[hourStemIdx], BRANCHES[hourBranchIdx]);

    chars.forEach(char => elementCount[getElement(char)]++);

    let yongsin = '토(土)';
    let mostElement = '토(土)';
    let minCount = 99;
    let maxCount = -1;

    for (const [element, count] of Object.entries(elementCount)) {
        if (count < minCount) {
            minCount = count;
            yongsin = element;
        }

        if (count >maxCount) {
            maxCount = count;
            mostElement = element;
        }
    }

    const GYEOKGUK = ['정관격', '편관격', '정재격', '편재격', '식신격', '상관격', '정인격', '편인격'];
    const gyeokguk = GYEOKGUK[dayHash % GYEOKGUK.length];

    return { saju, elementCount, yongsin, mostElement, gyeokguk, dayHash, nameHash, isUnknown, yearBranchIdx, dayStemIdx, dayBranchIdx };
}

app.post('/api/fortune/individual', (req, res) => {
    const { name, birthdate, birthtime } = req.body;

    if (!name || !birthdate) return res.status(400).json({ success: false, msg: '정보가 부족합니다.' });

    const info = calculateSajuEngine(name, birthdate, birthtime);
    const today = new Date();
    const todayHash = today.getFullYear() * 365 + today.getMonth() * 30 + today.getDate();
    const fortuneSeed = info.dayHash + todayHash;

    const SINSAL = ['천을귀인', '문창귀인', '학당귀인', '화개살', '역마살', '도화살', '홍염살', '귀문관살', '백호대살', '반안살'];
    const todaySinsal = SINSAL[fortuneSeed % SINSAL.length];
    const examComments = {
        '천을귀인': ' 귀인의 도움으로 막혔던 문제가 풀리고, 헷갈리던 개념이 확실히 잡힙니다.',
        '문창귀인': ' 학문과 지혜의 별이 떴습니다. 암기 과목 효율이 2배 오릅니다.',
        '학당귀인': ' 배움에 최적화된 날! 인강이나 새로운 개념 학습에 유리합니다.',
        '화개살': ' 고독하지만 집중력이 극대화됩니다. 혼자 독서실에서 공부하기 좋습니다.',
        '역마살': ' 장소를 도서관이나 카페로 옮겨서 분위기를 환기해 보세요.',
        '도화살': ' 유혹이 많은 날입니다. 스마트폰 알람을 끄고 집중하세요.',
        '홍염살': ' 감수성이 풍부해져 흐름을 이해하는 이론 공부에 유리합니다.',
        '귀문관살': ' 직관력이 최고조에 달해 찍기 운이 좋지만, 예민해질 수 있습니다.',
        '백호대살': ' 폭발적인 에너지! 단기 목표나 모의고사 풀이에 최고입니다.',
        '반안살': ' 명예를 얻을 기운이 강합니다. 시험에서 높은 점수를 기대할 수 있습니다.'
    };

    const result = {
        name,
        ...info,
        todaySinsal,
        score: 60 + (fortuneSeed % 41),
        totalLuck: `오늘은 ${name}님에게 부족한 ${info.yongsin} 기운을 보충하면 대길(大吉)하는 날입니다.`,
        examLuck: examComments[todaySinsal],
        loveLuck: fortuneSeed % 2 === 0 ? '주변 사람과의 소통이 원활해집니다.' : '오늘은 내 자신의 성장에 집중하는 거이 이득입니다.'
    };

    setTimeout(() => res.json({ success: true, data: result }), 1200);
});

app.post('/api/fortune/couple', (req, res) => {
    const { p1, p2 } = req.body;

    if (!p1?.name || !p1?.birthdate || !p2?.name || !p2?.birthdate) {
        return res.status(400).json({ success: false, msg: '정보 부족' });
    }

    const info1 = calculateSajuEngine(p1.name, p1.birthdate, p1.birthtime);
    const info2 = calculateSajuEngine(p2.name, p2.birthdate, p2.birthtime);

    let matchScore = 60;
    const details = { out: '', in: '', balance: '', flow: '' };

    const yearDiff = Math.abs(info1.yearBranchIdx - info2.yearBranchIdx);
    if (yearDiff === 4 || yearDiff === 8) {
        matchScore += 15;
        details.out = ' 삼합(三合): 서로 띠가 4년(또는 8년) 차이로 에너지가 잘 섞이며 협력하기 아주 좋은 찰떡 띠 궁합입니다.';
    } else if (yearDiff === 6) {
        matchScore -= 5;
        details.out = ' 충(沖): 띠의 기운이 정반대라 초기엔 끌릴 수 있으나, 가치관 차이로 부딪힘이 있을 수 있습니다.';
    } else if (yearDiff === 7 || yearDiff === 5) {
        matchScore -= 3;
        details.out = ' 원진(怨嗔): 서로 다름을 이해하지 못하면 서운함이 쌓일 수 있으니 배려가 필요합니다.';
    } else {
        matchScore += 5;
        details.out = ' 무난: 띠를 기준으로는 크게 부딪힘이 없는 평범하고 안정적인 관계입니다.';
    }

    const dayBranchDiff = Math.abs(info1.dayBranchIdx - info2.dayBranchIdx);
    if (dayBranchDiff === 4 || dayBranchDiff === 8 || dayBranchDiff === 2) {
        matchScore += 15;
        details.in = ' 일지 합(合): 배우자 자리가 합을 이루어 속마음이 잘 통하고 가치관이 매우 흡사합니다.';
    } else if (dayBranchDiff === 6) {
        matchScore -= 5;
        details.in = ' 일지 충(沖): 성향 차이가 뚜렷하여 서로의 독립적인 영역을 존중해야 오래갑니다.';
    } else {
        matchScore += 5;
        details.in = ' 일간 조화: 서로의 일간 오행이 무난하게 융화되어 잔잔하고 깊은 정을 나눌 수 있습니다.';
    }

    if (info1.yongsin === info2.mostElement && info2.yongsin === info1.mostElement) {
        matchScore += 15;
        details.balance = ' 완벽 보완: 나에게 부족한 기운을 상대가 채워주고, 상대의 부족함을 내가 채워주는 환상의 오행 밸런스입니다.';
    } else if (info1.yongsin === info2.mostElement || info2.yongsin === info1.mostElement) {
        matchScore += 10;
        details.balance = ' 한쪽의 조력: 한 사람이 상대방에게 꼭 필요한 에너지를 공급해 주는 든든한 조력자 역할을 합니다.';
    } else if (info1.yongsin === info2.yongsin) {
        matchScore -= 5;
        details.balance = ' 기운 치우침: 두 사람 모두 비슷한 오행이 부족합니다. 공감대는 크지만 결점이 같을 수 있습니다.';
    } else {
        matchScore += 5;
        details.balance = ' 무난한 조화: 사주의 온도와 습도가 적당히 유지되어 평온한 관계를 이룹니다.';
    }

    const today = new Date();
    const todayHash = today.getFullYear() * 365 + today.getMonth() * 30 + today.getDate();
    const flowScore = (info1.dayHash + info2.dayHash + todayHash) % 100;

    if (flowScore >= 80) {
        matchScore += 10;
        details.flow = ' 흐름 일치: 두 사람의 현재 운의 파동이 매우 비슷합니다. 굴곡을 함께 이겨내는 힘이 강합니다.';
    } else if (flowScore <= 20) {
        matchScore -= 5;
        details.flow = ' 리듬 차이: 현재 한쪽은 바쁘고 한쪽은 정체될 수 있습니다. 서로의 상황을 이해해주는 여유가 필요합니다.';
    } else {
        matchScore += 5;
        details.flow = ' 적절한 템포: 서로 운의 흐름이 엇갈리며 보완해 줄 수 있는 적절한 타이밍을 가지고 있습니다.';
    }

    if (matchScore >99) matchScore = 98;
    if (matchScore < 40) matchScore = 45 + (flowScore % 15);

    const result = {
        p1: { name: p1.name, saju: info1.saju, elementCount: info1.elementCount, yongsin: info1.yongsin },
        p2: { name: p2.name, saju: info2.saju, elementCount: info2.elementCount, yongsin: info2.yongsin },
        score: matchScore,
        details
    };

    setTimeout(() => res.json({ success: true, data: result }), 1500);
});
}

module.exports = registerFortuneRoutes;
