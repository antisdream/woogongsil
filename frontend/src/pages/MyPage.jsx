// 마이페이지 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import useScreenSettings from '../useScreenSettings';

const YEARS = Array.from({ length: 2026 - 2024 + 1 }, (_, i) => 2026 - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const API_BASE = '';

const MyPage = () => {
    const navigate = useNavigate();
    const userId = sessionStorage.getItem('userId');
    const { getSetting } = useScreenSettings('mypage');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = (key, fallback, values = {}) => {
        let text = t(key, fallback);
        Object.entries(values).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value));
        });
        return text;
    };

    const [user, setUser] = useState(null);
    const [dDate, setDDate] = useState({ year: '', month: '', day: '' });
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState(null);
    const [ipepWrongNotes, setIpepWrongNotes] = useState([]);

    useEffect(() => {
        if (!userId) {
            alert(t('messages.login_required', '로그인이 필요합니다.'));
            window.location.href = '/';
            return;
        }

        const fetchUserData = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/user/${userId}`);

                if (!res.data || res.data.msg) {
                    throw new Error(t('messages.user_not_found', '유저 정보를 찾을 수 없습니다.'));
                }

                setUser(res.data);

                try {
                    const ipepRes = await axios.get(`${API_BASE}/api/user/${userId}/ipep-wrongnotes`);
                    setIpepWrongNotes(Array.isArray(ipepRes.data?.wrongNotes) ? ipepRes.data.wrongNotes : []);
                } catch (ipepErr) {
                    console.warn('실기 오답노트 불러오기 실패:', ipepErr);
                    setIpepWrongNotes([]);
                }

                if (res.data.dDay) {
                    const parts = String(res.data.dDay).split('-');
                    if (parts.length === 3) {
                        setDDate({
                            year: parseInt(parts[0], 10) || '',
                            month: parseInt(parts[1], 10) || '',
                            day: parseInt(parts[2], 10) || ''
                        });
                    }
                }
            } catch (err) {
                console.error('유저 데이터 불러오기 에러:', err);
                setErrorMessage(t('messages.session_expired', '서버와 연결할 수 없거나, 세션이 만료되었습니다.'));
                sessionStorage.clear();
            } finally {
                setIsLoading(false);
            }
        };

        fetchUserData();
    }, [t, userId]);

    const handleDeleteAccount = async () => {
        const confirm1 = window.confirm(t('delete.first_confirm', '탈퇴를 하게되면 활동정보를 복구하실 수 없습니다. 탈퇴를 진행하시겠습니까?'));
        if (!confirm1) return;

        const inputPw = window.prompt(t('delete.password_prompt', '본인 확인을 위해 비밀번호를 입력해주세요.'));
        if (!inputPw) return;

        try {
            const res = await axios.post(`${API_BASE}/api/user/delete`, { id: userId, password: inputPw });
            if (res.data.success) {
                const confirm2 = window.confirm(t('delete.second_confirm', '비밀번호가 일치합니다. 탈퇴를 계속 진행하시겠습니까?'));
                if (confirm2) {
                    alert(t('delete.thanks_message', '그동안 이용해주셔서 감사합니다.'));
                    sessionStorage.clear();
                    window.location.href = '/';
                }
            }
        } catch (err) {
            alert(err.response?.data?.msg || t('delete.password_failed', '비밀번호가 일치하지 않습니다. 확인 후 다시 진행해주세요.'));
        }
    };

    const handleUpdateDDay = async () => {
        if (!dDate.year || !dDate.month || !dDate.day) {
            alert(t('messages.need_dday', '연도, 월, 일을 모두 선택해주세요.'));
            return;
        }

        const formattedDate = `${dDate.year}-${String(dDate.month).padStart(2, '0')}-${String(dDate.day).padStart(2, '0')}`;
        try {
            await axios.post(`${API_BASE}/api/user/update`, { id: userId, dDay: formattedDate });
            sessionStorage.setItem('dDay', formattedDate);
            alert(t('messages.dday_saved', 'D-Day가 저장되었습니다.'));
            window.location.reload();
        } catch (err) {
            alert(t('messages.save_failed', '저장 실패'));
        }
    };

    if (isLoading) {
        return (
            <div className="mypage wrong-note-page wgs-typography-scope" style={{ color: 'var(--wgs-wrong-text)', textAlign: 'center', marginTop: '50px', fontSize: '20px' }}>
                {t('loading.user_data', '사용자 데이터를 불러오는 중입니다...')}
            </div>
        );
    }

    if (errorMessage || !user) {
        return (
            <div className="mypage wrong-note-page wgs-typography-scope" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--wgs-wrong-text)', textAlign: 'center', marginTop: '50px', padding: '20px', background: 'var(--wgs-button-muted)', borderRadius: '12px', maxWidth: '400px', margin: '50px auto' }}>
                <h3 style={{ color: '#ef4444' }}>{t('error.title', '오류 발생')}</h3>
                <p style={{ color: 'var(--wgs-muted)' }}>{errorMessage || t('error.empty_user', '유저 정보를 표시할 수 없습니다.')}</p>
                <button type="button" onClick={() => window.location.href = '/'} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '20px', fontWeight: 'bold' }}>
                    {t('error.home_button', '메인 화면으로 돌아가기')}
                </button>
            </div>
        );
    }

    let dDayText = t('dday.empty_text', '설정된 D-Day가 없습니다.');
    if (user.dDay && typeof user.dDay === 'string') {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = new Date(user.dDay); target.setHours(0, 0, 0, 0);

        if (!Number.isNaN(target.getTime())) {
            const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            dDayText = diff > 0 ? `D-${diff}` : diff === 0 ? t('dday.today_text', 'D-Day (오늘입니다!)') : `D+${Math.abs(diff)}`;
        }
    }

    const loginHistoryArray = Array.isArray(user.loginHistory) ? user.loginHistory : [];
    const safeWrongNotes = Array.isArray(user.wrongNotes) ? user.wrongNotes : [];
    const randomWrongCount = safeWrongNotes.filter((q) => !q.source || q.source === 'random').length;
    const pastWrongCount = safeWrongNotes.filter((q) => q.source === 'past').length;
    const ipepRandomWrongCount = ipepWrongNotes.filter((q) => q.source === 'ipep_random').length;
    const ipepPastWrongCount = ipepWrongNotes.filter((q) => q.source === 'ipep_past').length;

    const wrongNoteCards = [
        {
            key: 'written_random',
            title: t('wrong_notes.written_random_title', '필기 문제은행 오답'),
            count: randomWrongCount,
            to: '/wrong?tab=random',
            color: 'var(--wgs-title)',
            background: '#3b82f6'
        },
        {
            key: 'written_past',
            title: t('wrong_notes.written_past_title', '필기 기출문제 오답'),
            count: pastWrongCount,
            to: '/wrong?tab=past',
            color: 'var(--wgs-title)',
            background: '#10b981'
        },
        {
            key: 'ipep_random',
            title: t('wrong_notes.ipep_random_title', '실기 문제은행 오답'),
            count: ipepRandomWrongCount,
            to: '/wrong?tab=ipep_random',
            color: '#fbbf24',
            background: '#f59e0b'
        },
        {
            key: 'ipep_past',
            title: t('wrong_notes.ipep_past_title', '실기 기출문제 오답'),
            count: ipepPastWrongCount,
            to: '/wrong?tab=ipep_past',
            color: '#fbbf24',
            background: '#8b5cf6'
        }
    ];

    return (
        <div
            className="mypage wrong-note-page wgs-typography-scope" style={{ width: '100%', maxWidth: '600px', margin: '40px auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', color: 'var(--wgs-wrong-text)', position: 'relative', boxSizing: 'border-box' }}
        >
            <h2 className="wgs-page-title" style={{ color: 'var(--wgs-title)', borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px' }}>{t('page.title', '마이페이지')}</h2>
            <div className="mypage-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0', gap: '12px' }}>
                <div>{formatSetting('page.greeting', '반갑습니다, {name} 님!', { name: user.name || t('page.default_user_name', '회원') })}</div>
                <button type="button" onClick={() => navigate('/change-pw')} style={{ padding: '8px 15px', background: 'var(--wgs-border)', color: 'white', border: '1px solid var(--wgs-blue)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                    {t('page.change_pw_button', '비밀번호 변경')}
                </button>
            </div>

            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ color: '#fcd34d', marginTop: 0 }}>{t('dday.title', '목표 시험일 설정')}</h3>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444', marginBottom: '15px' }}>{dDayText}</div>
                <div className="mypage-dday-selects" style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                    <select value={dDate.year} onChange={(e) => setDDate({ ...dDate, year: e.target.value })} style={{ flex: 1.5, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="">{t('dday.year_placeholder', '연도')}</option>
                        {YEARS.map((y) => <option key={y} value={y}>{formatSetting('dday.year_option', '{value}년', { value: y })}</option>)}
                    </select>
                    <select value={dDate.month} onChange={(e) => setDDate({ ...dDate, month: e.target.value })} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="">{t('dday.month_placeholder', '월')}</option>
                        {MONTHS.map((m) => <option key={m} value={m}>{formatSetting('dday.month_option', '{value}월', { value: m })}</option>)}
                    </select>
                    <select value={dDate.day} onChange={(e) => setDDate({ ...dDate, day: e.target.value })} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="">{t('dday.day_placeholder', '일')}</option>
                        {DAYS.map((d) => <option key={d} value={d}>{formatSetting('dday.day_option', '{value}일', { value: d })}</option>)}
                    </select>
                </div>
                <button type="button" onClick={handleUpdateDDay} style={{ width: '100%', padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{t('dday.save_button', 'D-Day 저장하기')}</button>
            </div>

            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ color: 'var(--wgs-blue)', marginTop: 0 }}>{t('wrong_notes.title', '오답노트 관리')}</h3>
                <p className="wrong-note-muted" style={{ color: 'var(--wgs-wrong-muted)', marginTop: 0, fontSize: '13px' }}>
                    {t('wrong_notes.desc', '필기/실기와 문제은행/기출문제를 구분해서 원하는 오답만 복습할 수 있습니다.')}
                </p>

                <div
                    className="mypage-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '15px', marginTop: '15px' }}
                >
                    {wrongNoteCards.map((card) => (
                        <div key={card.key} style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--wgs-border)', textAlign: 'center' }}>
                            <h4 style={{ color: card.color, margin: '0 0 10px 0' }}>{card.title}</h4>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fcd34d', marginBottom: '10px' }}>
                                {formatSetting('wrong_notes.count_label', '{count}개', { count: card.count })}
                            </div>
                            <button type="button" onClick={() => navigate(card.to)} style={{ width: '100%', padding: '8px', background: card.background, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                {t('wrong_notes.review_button', '복습하기')}
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '40px' }}>
                <h3 style={{ color: '#fbbf24', marginTop: 0 }}>{t('history.title', '최근 접속 기록')}</h3>
                <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: '10px' }}>
                    {loginHistoryArray.length > 0 ? (
                        <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                            {loginHistoryArray.map((hist, idx) => {
                                const isObject = typeof hist === 'object' && hist !== null;
                                const rawAction = isObject ? (hist.action || '') : String(hist || '');
                                const isLogin = rawAction.includes('로그인');
                                const isLogout = rawAction.includes('로그아웃');
                                const actionText = isLogin
                                    ? t('history.login_action', '로그인')
                                    : isLogout
                                        ? t('history.logout_action', '로그아웃')
                                        : t('history.default_action', '기록');
                                const timeText = isObject ? (hist.time || '') : String(hist || '').replace(/로그인|로그아웃/g, '').trim();

                                return (
                                    <li key={idx} className="mypage-login-history-row" style={{ padding: '10px', borderBottom: '1px solid var(--wgs-border)', display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '14px', color: 'var(--wgs-muted)' }}>
                                        <span style={{ color: isLogin ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>[{actionText}]</span>
                                        <span>{timeText}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p style={{ color: 'var(--wgs-subtle)', margin: 0 }}>{t('history.empty_text', '기록이 없습니다.')}</p>
                    )}
                </div>
            </div>

            <div style={{ textAlign: 'right' }}>
                <button type="button" onClick={handleDeleteAccount} style={{ background: 'transparent', color: '#ff4d4d', border: '1px solid #ff4d4d', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{t('delete.button', '회원 탈퇴')}</button>
            </div>
        </div>
    );
};

export default MyPage;
