// Home page feature module for calendarUtils.
export const getColorForSubject = (subject) => {
    if (subject.includes('프로그래밍과 데이터 기초')) return { bg: '#134e4a', text: '#ccfbf1' }; 
    if (subject.includes('데이터 분석과 머신러닝, 딥러닝') || subject.includes('데이터 분석')) return { bg: '#4c1d95', text: '#ede9fe' }; 
    if (subject.includes('LLM')) return { bg: '#1e3a8a', text: '#dbeafe' }; 
    if (subject.includes('AI 활용 애플리케이션 개발') || subject.includes('AI활용')) return { bg: '#881337', text: '#ffe4e6' }; 
    if (subject.includes('최종 프로젝트') || subject.includes('최종프로젝트')) return { bg: 'var(--wgs-practice-toggle-bg)', text: '#f8fafc' }; 
    return { bg: '#374151', text: '#f3f4f6' }; 
};
// 달력은 wgs_class_schedules DB 응답만 화면 표시 구조로 변환합니다.
// 공휴일/시험일 같은 category는 화면 문구에서 제외하고, 실제 이벤트명만 보여줍니다.
export const normalizeScheduleToCalendarEvent = (schedule) => {
    const rawDate = schedule?.date || schedule?.schedule_date || '';
    const date = String(rawDate || '').slice(0, 10);
    const clean = (value) => String(value ?? '').trim().replace(/"/g, '');
    const pickColor = (value, fallback) => {
        const text = clean(value);
        const isRgb = /^rgb\(\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*\)$/i.test(text);
        return /^#[0-9A-Fa-f]{6}$/.test(text) || text === 'transparent' || isRgb ? text : fallback;
    };

    const scheduleType = clean(schedule?.schedule_type ?? schedule?.scheduleType ?? schedule?.event_type ?? schedule?.eventType ?? 'class') || 'class';
    const eventCategory = clean(schedule?.event_category ?? schedule?.eventCategory ?? '');
    const rawDayNum = clean(schedule?.dayNum ?? schedule?.day_no ?? schedule?.day ?? '');

    const courseTitle = clean(schedule?.course_title ?? schedule?.courseTitle ?? schedule?.course ?? '');
    const topicTitle = clean(schedule?.topic_title ?? schedule?.topicTitle ?? schedule?.topic ?? schedule?.subject ?? '');
    const eventTitleRaw = clean(schedule?.event_title ?? schedule?.eventTitle ?? schedule?.title ?? '');

    const categoryWords = ['공휴일', '시험일', '원서접수', '결과발표', '특별한날', '특수일', '수업일정'];
    const isCategoryWord = (value) => {
        const text = clean(value);
        return Boolean(text) && (text === eventCategory || categoryWords.includes(text));
    };
    const stripCategoryPrefix = (value) => {
        let text = clean(value);
        [eventCategory, ...categoryWords].filter(Boolean).forEach((category) => {
            [' - ', '-', ' : ', ':', '：'].forEach((separator) => {
                const prefix = `${category}${separator}`;
                if (text.startsWith(prefix)) {
                    text = text.slice(prefix.length).trim();
                }
            });
        });
        return text.trim();
    };


    const isSpecialSchedule = scheduleType !== 'class';
    const specialTitle = [eventTitleRaw, topicTitle, courseTitle]
        .map(stripCategoryPrefix)
        .find((value) => value && !isCategoryWord(value)) || '';

    const titleParts = [];
    if (isSpecialSchedule) {
        if (specialTitle) titleParts.push(specialTitle);
    } else {
        [courseTitle, topicTitle].forEach((part) => {
            if (part && !titleParts.includes(part)) titleParts.push(part);
        });
    }

    const title = titleParts.join('-');
    const hasNumericDayNo = /^\d+$/.test(rawDayNum);
    const displayLabel = isSpecialSchedule
        ? title
        : (hasNumericDayNo ? `${rawDayNum}일차 - ${title}` : title);

    const dbBackground = pickColor(schedule?.background_color ?? schedule?.backgroundColor, '');
    const dbText = pickColor(schedule?.text_color ?? schedule?.textColor, '');
    const dbBorder = pickColor(schedule?.border_color ?? schedule?.borderColor, '');
    const fallbackColorSet = getColorForSubject(courseTitle || title);
    const isHoliday = scheduleType === 'holiday';
    const colorSet = {
        bg: isHoliday ? 'transparent' : (dbBackground || fallbackColorSet.bg),
        text: isHoliday ? '#ef4444' : (dbText || fallbackColorSet.text),
        border: isHoliday ? 'transparent' : (dbBorder || dbBackground || 'transparent'),
    };
    const isUnitProject = title.replace(/\s+/g, '').includes('단위프로젝트');

    if (!date || !title) return null;

    return {
        date,
        dayNum: hasNumericDayNo ? rawDayNum : '',
        title,
        displayLabel,
        colorSet,
        isUnitProject,
        scheduleType,
        eventCategory,
        isHoliday,
        highlightType: clean(schedule?.highlight_type ?? schedule?.highlightType ?? 'none') || 'none',
    };
};

// 달력 날짜 숫자 색상은 DB 이벤트 색상과 완전히 분리해서 계산합니다.
// - 빨강: 주말(토/일) 또는 DB에서 schedule_type='holiday'로 내려온 공휴일
// - 기본색: 그 외 모든 날짜
// Date 객체의 브라우저 시간대 차이를 줄이기 위해 UTC 기준으로 요일을 계산합니다.
export const getCalendarDayOfWeek = (dateText) => {
    const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return -1;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const isCalendarWeekend = (dateText) => {
    const dayOfWeek = getCalendarDayOfWeek(dateText);
    return dayOfWeek === 0 || dayOfWeek === 6;
};

export const isCalendarRedDate = (dateText, hasHoliday) => Boolean(hasHoliday) || isCalendarWeekend(dateText);

export const getCalendarDateNumberClass = () => 'home-calendar-date-number';

export const getCalendarDateNumberStyle = (dateText, hasHoliday) => {
    // 월 이동 시 같은 숫자 DOM이 재사용되어 이전 달의 빨간색 class가 남는 현상을 막기 위해
    // 색상은 class가 아닌 CSS 변수와 인라인 color로만 계산합니다.
    const dateColor = isCalendarRedDate(dateText, hasHoliday)
        ? '#ef4444'
        : 'var(--wgs-calendar-date-default)';

    return {
        '--wgs-date-number-color': dateColor,
        color: dateColor
    };
};


export const getKstTodayString = () => {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = formatter.formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';

    return year && month && day ? `${year}-${month}-${day}` : '';
};
