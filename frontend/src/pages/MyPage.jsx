// 마이페이지 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const YEARS = Array.from({ length: 2026 - 2024 + 1 }, (_, i) =>2026 - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const MyPage = () => {
    const navigate = useNavigate();
    const userId = sessionStorage.getItem('userId');
    const [user, setUser] = useState(null);
    const [dDate, setDDate] = useState({ year: '연도', month: '월', day: '일' });
    
    // 로딩 및 에러 상태 관리 (무한 로딩 및 블랙아웃 방지용)
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState(null);
    // 실기 오답노트는 기존 필기 오답노트와 저장 위치가 다르므로 별도 상태로 안전하게 관리합니다.
    const [ipepWrongNotes, setIpepWrongNotes] = useState([]);

    const API_BASE = "";

    useEffect(() => {
        if (!userId) {
            alert("로그인이 필요합니다."); 
            window.location.href = '/'; 
            return;
        }

        const fetchUserData = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/user/${userId}`);
                
                // 서버에서 응답이 없거나 에러 메시지가 온 경우 강제 에러 처리합니다
                if (!res.data || res.data.msg) {
                    throw new Error("유저 정보를 찾을 수 없습니다.");
                }

                setUser(res.data);

                // 실기 오답노트 개수도 마이페이지에서 함께 보여주기 위해 별도 API를 호출합니다.
                // 이 호출에 실패해도 기존 마이페이지 기능이 막히지 않도록 빈 배열로 처리합니다.
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
                            year: parseInt(parts[0]) || '연도', 
                            month: parseInt(parts[1]) || '월', 
                            day: parseInt(parts[2]) || '일' 
                        });
                    }
                }
            } catch (err) { 
                console.error("유저 데이터 불러오기 에러:", err); 
                setErrorMessage("서버와 연결할 수 없거나, 세션이 만료되었습니다.");
                sessionStorage.clear(); // 꼬여버린 세션 정보 강제 초기화
            } finally {
                setIsLoading(false); // 성공하든 실패하든 로딩 상태 무조건 해제
            }
        };

        fetchUserData();
    }, [userId]);

    const handleDeleteAccount = async () => {
        const confirm1 = window.confirm("탈퇴를 하게되면 활동정보를 복구하실 수 없습니다, 탈퇴를 진행하시겠습니까?");
        if (!confirm1) return;

        const inputPw = window.prompt("본인 확인을 위해 비밀번호를 입력해주세요.");
        if (!inputPw) return;

        try {
            const res = await axios.post(`${API_BASE}/api/user/delete`, { id: userId, password: inputPw });
            if (res.data.success) {
                const confirm2 = window.confirm("비밀번호가 일치합니다, 탈퇴를 계속 진행하시겠습니까?");
                if (confirm2) {
                    alert("그동안 이용해주셔서 감사합니다.");
                    sessionStorage.clear();
                    window.location.href = '/';
                }
            }
        } catch (err) {
            alert(err.response?.data?.msg || "비밀번호가 일치하지 않습니다, 확인 후 다시 진행해주시기 바랍니다.");
        }
    };

    const handleUpdateDDay = async () => {
        if (dDate.year === '연도' || dDate.month === '월' || dDate.day === '일') {
            return alert("연도, 월, 일을 모두 선택해주세요.");
        }
        const formattedDate = `${dDate.year}-${String(dDate.month).padStart(2, '0')}-${String(dDate.day).padStart(2, '0')}`;
        try {
            await axios.post(`${API_BASE}/api/user/update`, { id: userId, dDay: formattedDate });
            sessionStorage.setItem('dDay', formattedDate); // 홈 화면 연동을 위해 세션 갱신
            alert("D-Day가 저장되었습니다.");
            window.location.reload(); // 즉시 새로고침하여 안전하게 상태 동기화
        } catch (err) { 
            alert("저장 실패"); 
        }
    };

    // 무한 로딩 및 에러 처리합니다
    if (isLoading) return <div className="mypage wrong-note-page wgs-typography-scope" style={{ color: 'var(--wgs-wrong-text)', textAlign: 'center', marginTop: '50px', fontSize: '20px' }}> 사용자 데이터를 불러오는 중입니다...</div>;
    if (errorMessage || !user) {
        return (
            <div className="mypage wrong-note-page wgs-typography-scope" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--wgs-wrong-text)', textAlign: 'center', marginTop: '50px', padding: '20px', background: 'var(--wgs-button-muted)', borderRadius: '12px', maxWidth: '400px', margin: '50px auto' }}>
                <h3 style={{ color: '#ef4444' }}> 오류 발생</h3>
                <p style={{ color: 'var(--wgs-muted)' }}>{errorMessage || "유저 정보를 표시할 수 없습니다."}</p>
                <button onClick={() => window.location.href = '/'} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '20px', fontWeight: 'bold' }}>
                    메인 화면으로 돌아가기
                </button>
            </div>
        );
    }

    // D-Day 계산 로직
    let dDayText = "설정된 D-Day가 없습니다.";
    if (user.dDay && typeof user.dDay === 'string') {
        const today = new Date(); today.setHours(0,0,0,0);
        const target = new Date(user.dDay); target.setHours(0,0,0,0);
        
        if (!isNaN(target.getTime())) {
            const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            dDayText = diff >0 ? `D-${diff}` : diff === 0 ? "D-Day (오늘입니다!)" : `D+${Math.abs(diff)}`;
        }
    }

    const loginHistoryArray = Array.isArray(user.loginHistory) ? user.loginHistory : [];
    
    //  [수정/추가] 오답노트 개수 분리 연산
    const safeWrongNotes = Array.isArray(user.wrongNotes) ? user.wrongNotes : [];
    // 문제은행은 출처가 random이거나 예전 데이터(없을 때)
    const randomWrongCount = safeWrongNotes.filter(q => !q.source || q.source === 'random').length; 
    // 기출문제는 출처가 past인 데이터
    const pastWrongCount = safeWrongNotes.filter(q => q.source === 'past').length;
    // 실기 오답도 필기처럼 문제은행/기출문제로 분리합니다.
    const ipepRandomWrongCount = ipepWrongNotes.filter(q => q.source === 'ipep_random').length;
    const ipepPastWrongCount = ipepWrongNotes.filter(q => q.source === 'ipep_past').length;

    return (
        <div
            className="mypage wrong-note-page wgs-typography-scope" style={{ width: '100%', maxWidth: '600px', margin: '40px auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', color: 'var(--wgs-wrong-text)', position: 'relative', boxSizing: 'border-box' }}
        >
            {/* 마이페이지 제목도 공통 페이지 제목 클래스로 통일합니다. */}
            <h2 className="wgs-page-title" style={{ color: 'var(--wgs-title)', borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px' }}>마이페이지</h2>
            <div className="mypage-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0', gap: '12px' }}>
                <div>반갑습니다, <strong style={{ color: '#10b981' }}>{user.name || '회원'}</strong> 님!</div>
                <button onClick={() => navigate('/change-pw')} style={{ padding: '8px 15px', background: 'var(--wgs-border)', color: 'white', border: '1px solid var(--wgs-blue)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>비밀번호 변경</button>
            </div>

            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ color: '#fcd34d', marginTop: 0 }}>목표 시험일 설정</h3>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444', marginBottom: '15px' }}>{dDayText}</div>
                <div className="mypage-dday-selects" style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                    <select value={dDate.year} onChange={e => setDDate({...dDate, year: e.target.value})} style={{ flex: 1.5, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="연도">연도</option>
                        {YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
                    </select>
                    <select value={dDate.month} onChange={e => setDDate({...dDate, month: e.target.value})} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="월">월</option>
                        {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
                    </select>
                    <select value={dDate.day} onChange={e => setDDate({...dDate, day: e.target.value})} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'var(--wgs-wrong-text)' }}>
                        <option value="일">일</option>
                        {DAYS.map(d => <option key={d} value={d}>{d}일</option>)}
                    </select>
                </div>
                <button onClick={handleUpdateDDay} style={{ width: '100%', padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>D-Day 저장하기</button>
            </div>

            {/*  [수정/추가] 오답노트 분리 영역 */}
            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ color: 'var(--wgs-blue)', marginTop: 0 }}> 오답노트 관리</h3>
                <p className="wrong-note-muted" style={{ color: 'var(--wgs-wrong-muted)', marginTop: 0, fontSize: '13px' }}>
                    필기/실기와 문제은행/기출문제를 구분해서 원하는 오답만 복습할 수 있습니다.
                </p>

                <div
                    className="mypage-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '15px', marginTop: '15px' }}
                >
                    {/* 기존 필기 문제은행 오답노트 진입 경로 유지 */}
                    <div style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--wgs-border)', textAlign: 'center' }}>
                        <h4 style={{ color: 'var(--wgs-title)', margin: '0 0 10px 0' }}>필기 문제은행 오답</h4>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fcd34d', marginBottom: '10px' }}>{randomWrongCount}개</div>
                        <button onClick={() => navigate('/wrong?tab=random')} style={{ width: '100%', padding: '8px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>복습하기</button>
                    </div>

                    {/* 기존 필기 기출문제 오답노트 진입 경로 유지 */}
                    <div style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--wgs-border)', textAlign: 'center' }}>
                        <h4 style={{ color: 'var(--wgs-title)', margin: '0 0 10px 0' }}>필기 기출문제 오답</h4>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fcd34d', marginBottom: '10px' }}>{pastWrongCount}개</div>
                        <button onClick={() => navigate('/wrong?tab=past')} style={{ width: '100%', padding: '8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>복습하기</button>
                    </div>

                    {/* 실기 문제은행 오답노트 신규 진입 경로 */}
                    <div style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--wgs-border)', textAlign: 'center' }}>
                        <h4 style={{ color: '#fbbf24', margin: '0 0 10px 0' }}>실기 문제은행 오답</h4>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fcd34d', marginBottom: '10px' }}>{ipepRandomWrongCount}개</div>
                        <button onClick={() => navigate('/wrong?tab=ipep_random')} style={{ width: '100%', padding: '8px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>복습하기</button>
                    </div>

                    {/* 실기 기출문제 오답노트 신규 진입 경로 */}
                    <div style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--wgs-border)', textAlign: 'center' }}>
                        <h4 style={{ color: '#fbbf24', margin: '0 0 10px 0' }}>실기 기출문제 오답</h4>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fcd34d', marginBottom: '10px' }}>{ipepPastWrongCount}개</div>
                        <button onClick={() => navigate('/wrong?tab=ipep_past')} style={{ width: '100%', padding: '8px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>복습하기</button>
                    </div>
                </div>
            </div>

            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '8px', marginBottom: '40px' }}>
                <h3 style={{ color: '#fbbf24', marginTop: 0 }}>최근 접속 기록</h3>
                <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: '10px' }}>
                    {loginHistoryArray.length >0 ? (
                        <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                            {loginHistoryArray.map((hist, idx) => {
                                const isObject = typeof hist === 'object' && hist !== null;
                                const actionText = isObject ? (hist.action || '기록') : (String(hist || '').includes('로그인') ? '로그인' : '로그아웃');
                                const timeText = isObject ? (hist.time || '') : String(hist || '').replace(/로그인|로그아웃/g, '').trim();
                                const isLogin = actionText.includes('로그인');

                                return (
                                    <li key={idx} className="mypage-login-history-row" style={{ padding: '10px', borderBottom: '1px solid var(--wgs-border)', display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '14px', color: 'var(--wgs-muted)' }}>
                                        <span style={{ color: isLogin ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>[{actionText}]</span>
                                        <span>{timeText}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p style={{ color: 'var(--wgs-subtle)', margin: 0 }}>기록이 없습니다.</p>
                    )}
                </div>
            </div>

            <div style={{ textAlign: 'right' }}>
                <button onClick={handleDeleteAccount} style={{ background: 'transparent', color: '#ff4d4d', border: '1px solid #ff4d4d', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>회원 탈퇴</button>
            </div>
        </div>
    );
};

export default MyPage;
