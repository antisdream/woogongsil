// 오답노트 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useScreenSettings from '../useScreenSettings';

// 오답노트 공통 상수
// ------------------------------------------------------------
// DB의 source 값은 백엔드 기준과 일치해야 합니다.
// random : 필기 문제은행
// past : 필기 기출문제
// ipep_random : 실기 문제은행
// ipep_past : 실기 기출문제
const API_BASE = '';
const WRONG_TABS = ['random', 'past', 'ipep_random', 'ipep_past'];
const DEFAULT_TAB_LABELS = {
    random: '필기 문제은행',
    past: '필기 기출문제',
    ipep_random: '실기 문제은행',
    ipep_past: '실기 기출문제'
};

const TAB_COLORS = {
    random: '#3b82f6',
    past: '#10b981',
    ipep_random: '#f59e0b',
    ipep_past: '#8b5cf6'
};

const replaceSettingTokens = (text, values = {}) => {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
};

// 오답노트 탭을 /wrong/written-bank, /wrong/written-past, /wrong/ipep-bank, /wrong/ipep-past 주소와 연결합니다.
const WRONG_TAB_TO_ROUTE = {
    random: 'written-bank',
    past: 'written-past',
    ipep_random: 'ipep-bank',
    ipep_past: 'ipep-past'
};

const WRONG_ROUTE_TO_TAB = {
    'written-bank': 'random',
    'written-past': 'past',
    'ipep-bank': 'ipep_random',
    'ipep-past': 'ipep_past'
};

// 기출 오답 필터 카탈로그 유틸
// ------------------------------------------------------------
// 오답노트에서도 2021~2025, 1~3회차 같은 값을 하드코딩하지 않습니다.
// 서버의 /api/exam-catalogs가 내려주는 DB 기준 연도/회차만 필터에 표시합니다.
function normalizeExamCatalogList(rawCatalog = []) {
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
        .filter((entry) => entry.sessions.length >0)
        .sort((a, b) => b.year - a.year);
}

function getCatalogYearOptions(catalog = []) {
    return (Array.isArray(catalog) ? catalog : []).map((item) => item.year);
}

function getCatalogSessionOptions(catalog = [], selectedYear = 'ALL') {
    const sessions = new Set();

    (Array.isArray(catalog) ? catalog : [])
        .filter((item) => selectedYear === 'ALL' || String(item.year) === String(selectedYear))
        .forEach((item) => {
            (Array.isArray(item.sessions) ? item.sessions : [])
                .map((session) => Number(session))
                .filter((session) => Number.isFinite(session))
                .forEach((session) => sessions.add(session));
        });

    return Array.from(sessions).sort((a, b) => a - b);
}


const boxStyle = {
    background: 'var(--wgs-practice-toggle-bg)',
    border: '1px solid var(--wgs-button-muted)',
    borderRadius: '14px',
    padding: '22px',
    color: 'var(--wgs-wrong-text)'
};

const buttonStyle = {
    border: 'none',
    borderRadius: '10px',
    padding: '12px 18px',
    color: 'white',
    fontWeight: '900',
    cursor: 'pointer'
};

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getQuestionId(note) {
    return note?.question_id || note?.questionId || note?.id;
}

function getWrongNoteId(note) {
    return note?.wrongNoteId || note?.wrong_note_id || note?.wrongId;
}

function getQuestionText(note) {
    return note?.question_text || note?.questionText || note?.question || '';
}

function getCorrectAnswer(note) {
    return note?.correct_answer || note?.correctAnswer || note?.correct_label || note?.answer || note?.answer_normalized || note?.answer_raw || '';
}

function getExplanation(note) {
    return note?.explanation || note?.explanation_text || note?.explanationText || '';
}

function getOptions(note, formatOptionNumber = (number) => `${number}번`) {
    // 필기 오답노트 선택지 보정 처리합니다
    // ------------------------------------------------------------
    // 일부 필기 문제는 선택지 문장이 DB option_1~option_4에 저장되지 않고,
    // question_img 이미지 안에 ①~④ 보기가 함께 들어있는 형태로 적재될 수 있습니다.
    // 기존 코드는 option_1~option_4가 모두 비어 있으면 .filter(Boolean) 때문에
    // 버튼 자체가 사라졌습니다.
    // 그래서 기존 로직은 유지하되, 선택지 문장이 없고 정답 라벨이 1~4이거나
    // 문제 이미지가 있는 필기 문항이면 사용자가 답을 고를 수 있도록
    // 1번~4번 기본 버튼을 자동 생성합니다.
    const rawOptions = [
        note?.option_1 || note?.opt1,
        note?.option_2 || note?.opt2,
        note?.option_3 || note?.opt3,
        note?.option_4 || note?.opt4
    ].map((value) => String(value || '').trim());

    const hasAnyOptionText = rawOptions.some(Boolean);

    // 선택지 중 일부만 비어 있어도 버튼 개수는 4개가 유지되어야 합니다.
    // 비어 있는 선택지는 '1번', '2번'처럼 기본 표시명을 넣어줍니다.
    if (hasAnyOptionText) {
        return rawOptions.map((text, index) => text || formatOptionNumber(index + 1));
    }

    const correctLabel = String(note?.correct_label || note?.answer || '').trim();
    const hasFourChoiceCorrectLabel = /^[1-4]$/.test(correctLabel);
    const hasQuestionImage = Boolean(note?.question_img);

    // 보기 이미지형 객관식 문제는 선택지 텍스트가 없어도 1~4번 버튼이 필요합니다.
    if (hasFourChoiceCorrectLabel || hasQuestionImage) {
        return [1, 2, 3, 4].map(formatOptionNumber);
    }

    // 예외적으로 객관식 판단이 어려운 경우에는 현재 방식과 동일하게 선택지를 표시하지 않습니다.
    return [];
}

// 필기 subject_id는 현재 프로젝트에서 끝자리 0~4로 과목을 구분합니다.
function getWrittenSubjectInfo(note, subjectLabels = {}) {
    const subjectId = note?.subject_id || note?.subject || '';
    const explicitName = note?.subject_name || note?.subjectName || '';
    const lastChar = String(subjectId || '').trim().slice(-1);

    const map = {
        0: { no: 1, name: subjectLabels.subject_0 || '소프트웨어 설계' },
        1: { no: 2, name: subjectLabels.subject_1 || '소프트웨어 개발' },
        2: { no: 3, name: subjectLabels.subject_2 || '데이터베이스구축' },
        3: { no: 4, name: subjectLabels.subject_3 || '프로그래밍 언어 활용' },
        4: { no: 5, name: subjectLabels.subject_4 || '정보시스템 구축 관리' }
    };

    const mapped = map[lastChar];
    if (mapped) return { no: mapped.no, name: explicitName || mapped.name };
    return { no: subjectId || '?', name: explicitName || subjectLabels.unknown || '과목 정보 없음' };
}

function getWrittenQuestionNo(note) {
    // info_id가 실제 시험지 문항 번호입니다. 없으면 question_id를 대체값으로 사용합니다.
    return note?.info_id || note?.qno || note?.question_no || note?.questionNo || getQuestionId(note);
}

function getIpepSubjectLabel(note, helpers = {}) {
    const t = helpers.t || ((key, fallback) => fallback);
    const formatSetting = helpers.formatSetting || ((key, fallback, values) => replaceSettingTokens(fallback, values));
    // 실기 문제은행의 '01. 키워드 찾기'에서 01은 subject_code이고,
    // subject_no는 해당 과목 안의 문제 번호입니다.
    const rawSubjectCode = note?.subject_code || note?.subjectCode || '';
    const subjectCode = rawSubjectCode ? String(rawSubjectCode).padStart(2, '0') : '';
    const subjectName = note?.subject_name || note?.subjectName || note?.subject || '';

    if (subjectCode && subjectName) {
        return formatSetting('source.ipep_subject_with_code', '{code}. {name}', { code: subjectCode, name: subjectName });
    }
    if (subjectName) return subjectName;
    if (subjectCode) return formatSetting('source.ipep_subject_code_only', '{code}. 실기 과목', { code: subjectCode });
    return t('source.ipep_subject_unknown', '실기 과목 정보 없음');
}

function getIpepQuestionNo(note, index = 0, activeTab = '') {
    // 실기 문제은행은 subject_no가 과목 내부 문제번호입니다.
    if (activeTab === 'ipep_random' || note?.source === 'ipep_random') {
        return note?.subject_no || note?.subjectNo || note?.question_no || note?.questionNo || note?.qno || note?.qNumber || (index + 1);
    }
    return note?.question_no || note?.questionNo || note?.qno || note?.qNumber || note?.subject_no || note?.subjectNo || (index + 1);
}

// 문제 상단 출처 라벨을 요청 형식에 맞게 만든다.
function getSourceLabel(note, activeTab, index = 0, helpers = {}) {
    if (!note) return '';
    const t = helpers.t || ((key, fallback) => fallback);
    const formatSetting = helpers.formatSetting || ((key, fallback, values) => replaceSettingTokens(fallback, values));
    const subjectLabels = helpers.subjectLabels || {};

    if (activeTab === 'random' || activeTab === 'past') {
        const year = note.year || note.exam_year || t('source.unknown_year', '연도미상');
        const session = note.session || note.exam_session || t('source.unknown_session', '회차미상');
        const subject = getWrittenSubjectInfo(note, subjectLabels);
        const qno = getWrittenQuestionNo(note);
        return formatSetting('source.written', '{year}년 {session}회차 {subjectNo}과목 {subjectName} {questionNo}번문제', {
            year,
            session,
            subjectNo: subject.no,
            subjectName: subject.name,
            questionNo: qno
        });
    }

    if (activeTab === 'ipep_random') {
        return formatSetting('source.ipep_random', '{subject} {questionNo}번문제', {
            subject: getIpepSubjectLabel(note, helpers),
            questionNo: getIpepQuestionNo(note, index, activeTab)
        });
    }

    if (activeTab === 'ipep_past') {
        const year = note.year || note.exam_year || t('source.unknown_year', '연도미상');
        const session = note.session || note.exam_session || t('source.unknown_session', '회차미상');
        return formatSetting('source.ipep_past', '{year}년 {session}회차 {questionNo}번문제', {
            year,
            session,
            questionNo: getIpepQuestionNo(note, index, activeTab)
        });
    }

    return '';
}

function getIpepChoiceImageUrl(note) {
    if (!note) return '';

    const raw = note.choiceImgPath
        || note.choiceImageUrl
        || note.choiceImage
        || note.imageUrl
        || note.imagePath
        || note.image
        || note.questionImgPath
        || note.questionImg
        || note.question_img
        || note.choice_img_path
        || note.choice_img_file
        || note.choiceImgFile
        || '';

    if (!raw) return '';
    const value = String(raw).trim();
    if (!value) return '';

    if (value.startsWith('http')) return value;
    if (value.startsWith('/ipep-img/')) return value;

    const fileName = value.split(/[\\/]/).pop();
    if (!fileName) return '';

    const imageType = note.source === 'ipep_past' || note.examYear || note.exam_year ? 'past' : 'random';
    return `/ipep-img/${imageType}/${encodeURIComponent(fileName)}`;
}

function renderIpepChoiceImage(note, imageAlt = '실기 문제 이미지') {
    const imgUrl = getIpepChoiceImageUrl(note);
    if (!imgUrl) return null;

    return (
        <div style={{ marginTop: '14px' }}>
            <img
                src={imgUrl}
                alt={imageAlt} style={{ maxWidth: '100%', maxHeight: '520px', objectFit: 'contain', background: 'white', borderRadius: '8px', display: 'block' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
        </div>
    );
}

function sortNotesForPractice(notes, activeTab) {
    const copied = [...notes];

    // 기출 오답은 저장 역순보다 실제 시험 문제 번호 순서가 자연스럽다.
    if (activeTab === 'past') {
        copied.sort((a, b) => {
            const aSubject = safeNumber(String(a.subject_id || a.subject || '').slice(-1), 0);
            const bSubject = safeNumber(String(b.subject_id || b.subject || '').slice(-1), 0);
            if (aSubject !== bSubject) return aSubject - bSubject;
            return safeNumber(getWrittenQuestionNo(a), 0) - safeNumber(getWrittenQuestionNo(b), 0);
        });
    }

    if (activeTab === 'ipep_past') {
        copied.sort((a, b) => safeNumber(getIpepQuestionNo(a), 0) - safeNumber(getIpepQuestionNo(b), 0));
    }

    return copied;
}

const WrongPractice = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { wrongTab } = useParams();
    const userId = sessionStorage.getItem('userId') || '';
    const { getSetting } = useScreenSettings('wrong');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = useCallback((key, fallback, values = {}) => (
        replaceSettingTokens(t(key, fallback), values)
    ), [t]);

    const tabLabels = useMemo(() => ({
        random: t('tabs.random', DEFAULT_TAB_LABELS.random),
        past: t('tabs.past', DEFAULT_TAB_LABELS.past),
        ipep_random: t('tabs.ipep_random', DEFAULT_TAB_LABELS.ipep_random),
        ipep_past: t('tabs.ipep_past', DEFAULT_TAB_LABELS.ipep_past)
    }), [t]);

    const writtenSubjectLabels = useMemo(() => ({
        subject_0: t('subjects.written_0', '소프트웨어 설계'),
        subject_1: t('subjects.written_1', '소프트웨어 개발'),
        subject_2: t('subjects.written_2', '데이터베이스구축'),
        subject_3: t('subjects.written_3', '프로그래밍 언어 활용'),
        subject_4: t('subjects.written_4', '정보시스템 구축 관리'),
        unknown: t('subjects.written_unknown', '과목 정보 없음')
    }), [t]);

    const sourceLabelHelpers = useMemo(() => ({
        t,
        formatSetting,
        subjectLabels: writtenSubjectLabels
    }), [formatSetting, t, writtenSubjectLabels]);

    const formatOptionNumber = useCallback((number) => (
        formatSetting('question.option_number', '{number}번', { number })
    ), [formatSetting]);

    const queryTab = new URLSearchParams(location.search).get('tab');
    const routeTab = WRONG_ROUTE_TO_TAB[wrongTab];
    const initialTab = WRONG_TABS.includes(routeTab) ? routeTab : (WRONG_TABS.includes(queryTab) ? queryTab : 'random');

    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        if (routeTab && routeTab !== activeTab) {
            setActiveTab(routeTab);
        }
    }, [activeTab, routeTab]);

    const [writtenNotes, setWrittenNotes] = useState([]);
    const [ipepNotes, setIpepNotes] = useState({ random: [], past: [] });
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState('');
    const [ipepAnswer, setIpepAnswer] = useState('');
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isChecking, setIsChecking] = useState(false);

    // 필기/실기 기출 오답은 선택한 연도·회차만 복습할 수 있게 별도 필터를 둔다.
    const [writtenPastFilter, setWrittenPastFilter] = useState({ year: 'ALL', session: 'ALL' });
    const [ipepPastFilter, setIpepPastFilter] = useState({ year: 'ALL', session: 'ALL' });

    // - 필기 기출: questions 테이블 기준 /api/exam-catalogs written 사용합니다
    // - 실기 기출: ipep_exam_catalog 기준 /api/exam-catalogs ipep_past 사용합니다
    // - 새 연도/회차가 DB에 추가되면 오답노트 필터도 자동 확장됩니다.
    const [examCatalogs, setExamCatalogs] = useState({
        written: [],
        ipep_past: [],
    });

    useEffect(() => {
        let isMounted = true;

        const fetchExamCatalogs = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/exam-catalogs`);
                if (!isMounted) return;

                setExamCatalogs({
                    written: normalizeExamCatalogList(res.data?.data?.written || res.data?.written || []),
                    ipep_past: normalizeExamCatalogList(res.data?.data?.ipep_past || res.data?.ipep_past || []),
                });
            } catch (error) {
                console.error('오답노트 기출 연도/회차 카탈로그 불러오기 실패:', error);
                if (!isMounted) return;
                setExamCatalogs({ written: [], ipep_past: [] });
            }
        };

        fetchExamCatalogs();

        return () => {
            isMounted = false;
        };
    }, []);

    const writtenPastYearOptions = getCatalogYearOptions(examCatalogs.written);
    const writtenPastSessionOptions = getCatalogSessionOptions(examCatalogs.written, writtenPastFilter.year);

    const ipepPastYearOptions = getCatalogYearOptions(examCatalogs.ipep_past);
    const ipepPastSessionOptions = getCatalogSessionOptions(examCatalogs.ipep_past, ipepPastFilter.year);

    const isWrittenTab = activeTab === 'random' || activeTab === 'past';

    async function fetchWrongNotes() {
        if (!userId) {
            alert(t('messages.login_required', '로그인이 필요합니다.'));
            navigate('/');
            return;
        }

        setIsLoading(true);
        try {
            const [writtenRes, ipepRes] = await Promise.all([
                axios.get(`${API_BASE}/api/user/${userId}`),
                axios.get(`${API_BASE}/api/user/${userId}/ipep-wrongnotes`)
            ]);

            setWrittenNotes(Array.isArray(writtenRes.data?.wrongNotes) ? writtenRes.data.wrongNotes : []);
            setIpepNotes({
                random: Array.isArray(ipepRes.data?.random) ? ipepRes.data.random : [],
                past: Array.isArray(ipepRes.data?.past) ? ipepRes.data.past : []
            });
        } catch (error) {
            console.error('오답노트 조회 실패:', error);
            alert(t('messages.load_failed', '오답노트를 불러오지 못했습니다. 서버 상태를 확인해 주세요.'));
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchWrongNotes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    useEffect(() => {
        setCurrentIndex(0);
        setSelectedAnswer('');
        setIpepAnswer('');
        setResult(null);
    }, [activeTab, writtenPastFilter.year, writtenPastFilter.session, ipepPastFilter.year, ipepPastFilter.session]);

    const visibleNotes = useMemo(() => {
        let notes = [];

        if (activeTab === 'random') {
            notes = writtenNotes.filter(note => !note.source || note.source === 'random');
        }

        if (activeTab === 'past') {
            notes = writtenNotes.filter(note => note.source === 'past');
            if (writtenPastFilter.year !== 'ALL') {
                notes = notes.filter(note => Number(note.year || note.exam_year) === Number(writtenPastFilter.year));
            }
            if (writtenPastFilter.session !== 'ALL') {
                notes = notes.filter(note => Number(note.session || note.exam_session) === Number(writtenPastFilter.session));
            }
        }

        if (activeTab === 'ipep_random') {
            notes = ipepNotes.random || [];
        }

        if (activeTab === 'ipep_past') {
            notes = ipepNotes.past || [];
            if (ipepPastFilter.year !== 'ALL') {
                notes = notes.filter(note => Number(note.year || note.exam_year) === Number(ipepPastFilter.year));
            }
            if (ipepPastFilter.session !== 'ALL') {
                notes = notes.filter(note => Number(note.session || note.exam_session) === Number(ipepPastFilter.session));
            }
        }

        return sortNotesForPractice(notes, activeTab);
    }, [activeTab, writtenNotes, ipepNotes, writtenPastFilter, ipepPastFilter]);

    const currentNote = visibleNotes[currentIndex] || null;

    function changeTab(nextTab) {
        setActiveTab(nextTab);
        navigate(`/wrong/${WRONG_TAB_TO_ROUTE[nextTab] || 'written-bank'}`, { replace: true });
    }

    async function handleDeleteCurrent() {
        if (!currentNote) return;
        if (!window.confirm(t('messages.confirm_delete_current', '현재 오답 1개를 삭제할까요?'))) return;

        try {
            if (isWrittenTab) {
                await axios.post(`${API_BASE}/api/remove-wrong`, {
                    id: userId,
                    source: activeTab,
                    wrongNoteId: getWrongNoteId(currentNote),
                    question_id: getQuestionId(currentNote)
                });
            } else {
                await axios.post(`${API_BASE}/api/remove-ipep-wrong`, {
                    id: userId,
                    source: activeTab,
                    wrongNoteId: getWrongNoteId(currentNote),
                    question_id: getQuestionId(currentNote)
                });
            }

            await fetchWrongNotes();
            setCurrentIndex(prev => Math.max(0, Math.min(prev, visibleNotes.length - 2)));
            setResult(null);
            setSelectedAnswer('');
            setIpepAnswer('');
        } catch (error) {
            console.error('현재 오답 삭제 실패:', error);
            alert(t('messages.delete_failed', '오답 삭제 중 오류가 발생했습니다.'));
        }
    }

    async function handleDeleteAllInTab() {
        const tabName = tabLabels[activeTab];
        const isFilteredWrittenPast = activeTab === 'past' && (writtenPastFilter.year !== 'ALL' || writtenPastFilter.session !== 'ALL');
        const isFilteredIpepPast = activeTab === 'ipep_past' && (ipepPastFilter.year !== 'ALL' || ipepPastFilter.session !== 'ALL');

        let targetText = tabName;
        if (isFilteredWrittenPast) {
            const yearText = writtenPastFilter.year === 'ALL'
                ? t('filter.all_year_compact', '전체연도')
                : formatSetting('filter.year_value', '{year}년', { year: writtenPastFilter.year });
            const sessionText = writtenPastFilter.session === 'ALL'
                ? t('filter.all_session_compact', '전체회차')
                : formatSetting('filter.session_value', '{session}회차', { session: writtenPastFilter.session });
            targetText += ` ${yearText} ${sessionText}`;
        }
        if (isFilteredIpepPast) {
            const yearText = ipepPastFilter.year === 'ALL'
                ? t('filter.all_year_compact', '전체연도')
                : formatSetting('filter.year_value', '{year}년', { year: ipepPastFilter.year });
            const sessionText = ipepPastFilter.session === 'ALL'
                ? t('filter.all_session_compact', '전체회차')
                : formatSetting('filter.session_value', '{session}회차', { session: ipepPastFilter.session });
            targetText += ` ${yearText} ${sessionText}`;
        }

        if (!window.confirm(formatSetting('messages.confirm_delete_all', '{target} 오답 {count}개를 삭제할까요?', { target: targetText, count: visibleNotes.length }))) return;

        try {
            if (isWrittenTab) {
                await axios.post(`${API_BASE}/api/remove-all-wrong`, {
                    id: userId,
                    source: activeTab,
                    year: activeTab === 'past'? writtenPastFilter.year : 'ALL',
                    session: activeTab === 'past'? writtenPastFilter.session : 'ALL'
                });
            } else {
                await axios.post(`${API_BASE}/api/remove-all-ipep-wrong`, {
                    id: userId,
                    source: activeTab,
                    year: activeTab === 'ipep_past'? ipepPastFilter.year : 'ALL',
                    session: activeTab === 'ipep_past'? ipepPastFilter.session : 'ALL'
                });
            }

            await fetchWrongNotes();
            setCurrentIndex(0);
            setResult(null);
            setSelectedAnswer('');
            setIpepAnswer('');
        } catch (error) {
            console.error('현재 탭 전체 삭제 실패:', error);
            alert(t('messages.delete_all_failed', '전체 삭제 중 오류가 발생했습니다.'));
        }
    }

    function handleWrittenCheck() {
        if (!currentNote) return;
        if (!selectedAnswer) return alert(t('messages.need_written_answer', '정답을 선택해 주세요.'));

        const correct = String(selectedAnswer) === String(currentNote.correct_label || currentNote.answer);
        setResult({
            isCorrect: correct,
            correctAnswer: currentNote.correct_label || currentNote.answer,
            explanation: getExplanation(currentNote)
        });
    }

    async function handleIpepCheck() {
        if (!currentNote) return;
        if (!String(ipepAnswer || '').trim()) return alert(t('messages.need_ipep_answer', '실기 답안을 입력해 주세요.'));

        setIsChecking(true);
        try {
            const res = await axios.post(`${API_BASE}/api/ipep/check-answer`, {
                source: activeTab,
                questionId: getQuestionId(currentNote),
                userAnswer: ipepAnswer
            });

            const data = res.data || {};
            if (data.requiresSelfCheck) {
                const ok = window.confirm(
                    formatSetting('messages.self_check_confirm', '[자기채점 필요]\n\n내 답안:\n{userAnswer}\n\n정답 예시:\n{correctAnswer}\n\n정답으로 처리할까요?', {
                        userAnswer: ipepAnswer,
                        correctAnswer: data.correctAnswer || getCorrectAnswer(currentNote)
                    })
                );
                setResult({
                    isCorrect: ok,
                    correctAnswer: data.correctAnswer || getCorrectAnswer(currentNote),
                    explanation: data.explanation || getExplanation(currentNote),
                    score: ok ? Number(data.maxScore || currentNote.score || 5) : 0,
                    maxScore: Number(data.maxScore || currentNote.score || 5)
                });
            } else {
                setResult({
                    isCorrect: Boolean(data.isCorrect),
                    correctAnswer: data.correctAnswer || getCorrectAnswer(currentNote),
                    explanation: data.explanation || getExplanation(currentNote),
                    score: Number(data.score || 0),
                    maxScore: Number(data.maxScore || currentNote.score || 5)
                });
            }
        } catch (error) {
            console.error('실기 오답 채점 실패:', error);
            alert(t('messages.ipep_check_failed', '실기 오답 채점 중 오류가 발생했습니다.'));
        } finally {
            setIsChecking(false);
        }
    }

    function moveQuestion(direction) {
        setCurrentIndex(prev => {
            const next = Math.max(0, Math.min(visibleNotes.length - 1, prev + direction));
            return next;
        });
        setSelectedAnswer('');
        setIpepAnswer('');
        setResult(null);
    }

    function renderWrittenQuestion() {
        const options = getOptions(currentNote, formatOptionNumber);
        const correctAnswer = String(currentNote?.correct_label || currentNote?.answer || '');

        return (
            <>
                <div style={{ background: 'var(--wgs-wrong-question-bg)', border: '1px solid var(--wgs-wrong-border)', borderRadius: '10px', padding: '16px', marginBottom: '16px', lineHeight: 1.7 }}>
                    <strong style={{ color: 'var(--wgs-title)' }}>Q. </strong>{getQuestionText(currentNote)}
                </div>

                {currentNote?.question_img && (
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                        <img
                            src={`/question_image/${currentNote.question_img}`}
                            alt={t('image.written_alt', '필기 문제 이미지')} style={{ maxWidth: '100%', maxHeight: '420px', objectFit: 'contain', background: 'white', borderRadius: '8px' }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {options.map((option, index) => {
                        const label = String(index + 1);
                        const isSelected = String(selectedAnswer) === label;
                        const isCorrectChoice = result && correctAnswer === label;
                        const isWrongSelected = result && isSelected && correctAnswer !== label;

                        let bg = 'var(--wgs-wrong-option-bg)';
                        if (isCorrectChoice) bg = 'rgba(16, 185, 129, 0.35)';
                        else if (isWrongSelected) bg = 'rgba(239, 68, 68, 0.35)';
                        else if (isSelected) bg = 'rgba(59, 130, 246, 0.30)';

                        return (
                            <button
                                key={`${getQuestionId(currentNote)}-${label}`}
                                onClick={() => !result && setSelectedAnswer(label)}
                                disabled={Boolean(result)}
                                style={{
                                    textAlign: 'left',
                                    padding: '14px',
                                    borderRadius: '10px',
                                    border: isSelected ? '1px solid var(--wgs-blue)' : '1px solid var(--wgs-button-muted)',
                                    background: bg,
                                    color: 'var(--wgs-wrong-text)',
                                    fontWeight: '800',
                                    cursor: result ? 'default' : 'pointer'
                                }}
                            >
                                {label}. {option}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={handleWrittenCheck}
                    disabled={Boolean(result)}
                    style={{ ...buttonStyle, width: '100%', background: '#059669', marginTop: '18px', opacity: result ? 0.65 : 1 }}
                >
                    {t('buttons.check_answer', '정답 확인하기')}
                </button>
            </>
        );
    }

    function renderIpepQuestion() {
        return (
            <>
                <div style={{ background: 'var(--wgs-wrong-question-bg)', border: '1px solid var(--wgs-wrong-border)', borderRadius: '10px', padding: '16px', marginBottom: '16px', lineHeight: 1.7 }}>
                    <strong style={{ color: 'var(--wgs-title)' }}>Q. </strong>{getQuestionText(currentNote)}
                    {renderIpepChoiceImage(currentNote, t('image.ipep_alt', '실기 문제 이미지'))}
                </div>

                <textarea
                    value={ipepAnswer}
                    onChange={(e) => setIpepAnswer(e.target.value)}
                    disabled={Boolean(result) || isChecking}
                    placeholder={t('form.ipep_answer_placeholder', '실기 답안을 입력해 주세요.')} style={{ width: '100%', minHeight: '130px', boxSizing: 'border-box', background: 'var(--wgs-wrong-input-bg)', color: 'var(--wgs-wrong-text)', border: '1px solid var(--wgs-wrong-border)', borderRadius: '10px', padding: '14px', lineHeight: 1.6, resize: 'vertical' }}
                />

                <button
                    onClick={handleIpepCheck}
                    disabled={Boolean(result) || isChecking}
                    style={{ ...buttonStyle, width: '100%', background: '#059669', marginTop: '14px', opacity: result || isChecking ? 0.65 : 1 }}
                >
                    {isChecking ? t('buttons.checking', '채점 중...') : t('buttons.check_answer', '정답 확인하기')}
                </button>
            </>
        );
    }

    function renderFilterBox() {
        if (activeTab === 'past') {
            return (
                <section style={{ ...boxStyle, marginTop: '14px', marginBottom: '14px' }}>
                    <h4 style={{ color: 'var(--wgs-title)', margin: '0 0 12px 0' }}>{t('filter.written_past_title', '필기 기출 회차 필터')}</h4>
                    <div className="wrong-note-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                        <select value={writtenPastFilter.year} onChange={(e) => setWrittenPastFilter({ year: e.target.value, session: 'ALL' })} style={selectStyle}>
                            <option value="ALL">{t('filter.all_year', '전체 연도')}</option>
                            {writtenPastYearOptions.map(year => <option key={year} value={year}>{formatSetting('filter.year_value', '{year}년', { year })}</option>)}
                        </select>
                        <select value={writtenPastFilter.session} onChange={(e) => setWrittenPastFilter(prev => ({ ...prev, session: e.target.value }))} style={selectStyle}>
                            <option value="ALL">{t('filter.all_session', '전체 회차')}</option>
                            {writtenPastSessionOptions.map(session => <option key={session} value={session}>{formatSetting('filter.session_value', '{session}회차', { session })}</option>)}
                        </select>
                    </div>
                    <button onClick={() => setWrittenPastFilter({ year: 'ALL', session: 'ALL' })} style={{ ...buttonStyle, background: 'var(--wgs-button-muted)', marginTop: '12px' }}>{t('buttons.reset_filter', '필터 초기화')}</button>
                </section>
            );
        }

        if (activeTab === 'ipep_past') {
            const sessions = ipepPastSessionOptions;
            return (
                <section style={{ ...boxStyle, marginTop: '14px', marginBottom: '14px' }}>
                    <h4 style={{ color: 'var(--wgs-title)', margin: '0 0 12px 0' }}>{t('filter.ipep_past_title', '실기 기출 회차 필터')}</h4>
                    <div className="wrong-note-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                        <select value={ipepPastFilter.year} onChange={(e) => setIpepPastFilter({ year: e.target.value, session: 'ALL' })} style={selectStyle}>
                            <option value="ALL">{t('filter.all_year', '전체 연도')}</option>
                            {ipepPastYearOptions.map(year => <option key={year} value={year}>{formatSetting('filter.year_value', '{year}년', { year })}</option>)}
                        </select>
                        <select value={ipepPastFilter.session} onChange={(e) => setIpepPastFilter(prev => ({ ...prev, session: e.target.value }))} style={selectStyle}>
                            <option value="ALL">{t('filter.all_session', '전체 회차')}</option>
                            {sessions.map(session => <option key={session} value={session}>{formatSetting('filter.session_value', '{session}회차', { session })}</option>)}
                        </select>
                    </div>
                    <button onClick={() => setIpepPastFilter({ year: 'ALL', session: 'ALL' })} style={{ ...buttonStyle, background: 'var(--wgs-button-muted)', marginTop: '12px' }}>{t('buttons.reset_filter', '필터 초기화')}</button>
                </section>
            );
        }

        return null;
    }

    if (isLoading) {
        return <div className="wrong-note-page wgs-typography-scope" style={{ color: 'var(--wgs-wrong-text)', textAlign: 'center', marginTop: '50px' }}>{t('messages.loading', '오답노트를 불러오는 중입니다...')}</div>;
    }

    return (
        <div
            className="wrong-note-page wgs-typography-scope" style={{ width: '100%', maxWidth: '1100px', margin: '30px auto', color: 'var(--wgs-wrong-text)', boxSizing: 'border-box' }}
        >
            <button onClick={() => navigate('/mypage')} style={{ ...buttonStyle, background: 'var(--wgs-button-muted)', marginBottom: '18px' }}>{t('buttons.mypage', '마이페이지')}</button>

            <section style={{ ...boxStyle, display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                    {/* 오답노트 제목은 다른 학습 페이지와 같은 제목 체계를 사용합니다. */}
                    <h2 className="wgs-page-title" style={{ color: 'var(--wgs-blue)', margin: '0 0 12px 0', fontSize: '32px' }}>{t('page.title', ' 오답노트 응시')}</h2>
                    <p style={{ color: 'var(--wgs-wrong-muted)', margin: 0 }}>{t('page.description', '필기/실기, 문제은행/기출문제를 나눠서 복습합니다.')}</p>
                </div>
                <button onClick={handleDeleteAllInTab} disabled={visibleNotes.length === 0} style={{ ...buttonStyle, background: '#ef4444', opacity: visibleNotes.length === 0 ? 0.5 : 1 }}>
                    {t('buttons.delete_all_tab', '현재 탭 전체 삭제')}
                </button>
            </section>

            <div
                className="wrong-note-tabs" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px', marginTop: '18px' }}
            >
                {WRONG_TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => changeTab(tab)}
                        style={{ ...buttonStyle, background: activeTab === tab ? TAB_COLORS[tab] : 'var(--wgs-button-muted)', fontSize: '16px' }}
                    >
                        {tabLabels[tab]}
                    </button>
                ))}
            </div>

            {renderFilterBox()}

            {visibleNotes.length === 0 ? (
                <section style={{ ...boxStyle, marginTop: '18px', textAlign: 'center', color: 'var(--wgs-wrong-muted)' }}>
                    <h3 style={{ color: '#10b981' }}>{t('messages.empty_title', '현재 조건에 해당하는 오답이 없습니다.')}</h3>
                    <p>{t('messages.empty_desc', '문제를 풀고 틀린 문제를 저장하면 이곳에서 복습할 수 있습니다.')}</p>
                </section>
            ) : (
                <section style={{ ...boxStyle, marginTop: '18px' }}>
                    <div className="wrong-note-current-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                        <span style={{ background: TAB_COLORS[activeTab], borderRadius: '999px', padding: '10px 16px', fontWeight: '900' }}>{tabLabels[activeTab]}</span>
                        <strong className="wrong-note-muted" style={{ color: 'var(--wgs-wrong-text)' }}>{currentIndex + 1} / {visibleNotes.length}</strong>
                    </div>

                    <div className="wrong-note-muted" style={{ color: 'var(--wgs-wrong-muted)', fontWeight: '900', marginBottom: '12px' }}>
                        {getSourceLabel(currentNote, activeTab, currentIndex, sourceLabelHelpers)}
                    </div>

                    {isWrittenTab ? renderWrittenQuestion() : renderIpepQuestion()}

                    {result && (
                        <div style={{ marginTop: '18px', padding: '16px', borderRadius: '10px', background: result.isCorrect ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)', border: `1px solid ${result.isCorrect ? '#10b981' : '#ef4444'}` }}>
                            <h3 style={{ marginTop: 0, color: result.isCorrect ? '#34d399' : '#f87171' }}>{result.isCorrect ? t('result.correct_title', '정답입니다.') : t('result.wrong_title', '다시 확인해볼 문제입니다.')}</h3>
                            <p style={{ margin: '8px 0', color: 'var(--wgs-text)' }}>{t('result.correct_answer_label', '정답:')} <strong>{result.correctAnswer}</strong></p>
                            {typeof result.score !== 'undefined' && <p style={{ margin: '8px 0', color: 'var(--wgs-text)' }}>{t('result.score_label', '점수:')} <strong>{result.score} / {result.maxScore}</strong></p>}
                            {result.explanation && <p style={{ whiteSpace: 'pre-wrap', color: 'var(--wgs-wrong-muted)', lineHeight: 1.7 }}>{result.explanation}</p>}
                        </div>
                    )}

                    <div className="wrong-note-action-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '22px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="wrong-note-prev-next" style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => moveQuestion(-1)} disabled={currentIndex === 0} style={{ ...buttonStyle, background: currentIndex === 0 ? 'var(--wgs-button-muted)' : 'var(--wgs-button-muted)', opacity: currentIndex === 0 ? 0.5 : 1 }}>{t('buttons.prev', '이전')}</button>
                            <button onClick={() => moveQuestion(1)} disabled={currentIndex === visibleNotes.length - 1} style={{ ...buttonStyle, background: currentIndex === visibleNotes.length - 1 ? 'var(--wgs-button-muted)' : 'var(--wgs-button-muted)', opacity: currentIndex === visibleNotes.length - 1 ? 0.5 : 1 }}>{t('buttons.next', '다음')}</button>
                        </div>
                        <button onClick={handleDeleteCurrent} style={{ ...buttonStyle, background: '#ef4444' }}>{t('buttons.delete_current', '현재 오답 삭제')}</button>
                    </div>
                </section>
            )}
        </div>
    );
};

const selectStyle = {
    width: '100%',
    padding: '12px',
    background: 'var(--wgs-wrong-input-bg)',
    color: 'var(--wgs-wrong-text)',
    border: '1px solid var(--wgs-wrong-border)',
    borderRadius: '8px',
    fontWeight: '900'
};

export default WrongPractice;
