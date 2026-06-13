import { useEffect, useState } from 'react';

function RealTimeClock({ loggedInUser, handleLogout, isExamActive, examWarningCount }) {
    const [time, setTime] = useState(new Date());
    const [sessionTime, setSessionTime] = useState(3600);

    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    useEffect(() => {
        let sessionTimer;

        if (loggedInUser) {
            sessionTimer = setInterval(() => {
                setSessionTime(prev => prev - 1);
            }, 1000);
        } else {
            setSessionTime(3600);
        }

        return () => clearInterval(sessionTimer);
    }, [loggedInUser]);

    useEffect(() => {
        if (!loggedInUser) return;

        if (sessionTime === 300) {
            const extend = window.confirm('로그인 유지시간이 5분 남았습니다. 계속 로그인을 유지하시겠습니까?');
            if (extend) {
                setSessionTime(3600);
            }
        } else if (sessionTime <= 0) {
            handleLogout({ reason: 'session_expired', isForced: false, callLogoutApi: true });
        }
    }, [sessionTime, loggedInUser, handleLogout]);

    const formatTime = time.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    return (
        <div
            className="wgs-clock-bar wgs-type-caption"
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                background: 'var(--wgs-panel-bg)',
                padding: '15px 20px',
                borderRadius: '12px',
                marginBottom: '15px',
                border: '1px solid var(--wgs-border)',
                boxShadow: '0 4px 15px var(--wgs-shadow)',
            }}
        >
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--wgs-title)' }}>현재 시간: {formatTime}</div>
            {loggedInUser && (
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: sessionTime <= 300 ? '#ef4444' : '#10b981' }}>
                    로그인 유지: {Math.floor(sessionTime / 60)}분 {sessionTime % 60}초
                </div>
            )}
            {isExamActive && (
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f97316' }}>
                    시험 이탈 경고: {examWarningCount}회
                </div>
            )}
        </div>
    );
}

export default RealTimeClock;
