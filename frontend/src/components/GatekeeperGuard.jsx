// Shared UI component used across frontend pages.
import React, { useEffect, useState } from 'react';
import HCaptchaBox from './HCaptchaBox';
import { guardMissingHcaptcha } from '../hcaptchaGuard';

const API_BASE = '';

export default function GatekeeperGuard({ children }) {
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(false);
    const [code, setCode] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [hcaptchaToken, setHcaptchaToken] = useState('');
    const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
    const [hcaptchaResetKey, setHcaptchaResetKey] = useState(0);

    const checkStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/gatekeeper/status`, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });

            const data = await res.json().catch(() => ({}));
            setAllowed(Boolean(data.allowed));
        } catch (error) {
            console.error('게이트키퍼 상태 확인 실패:', error);
            setAllowed(false);
            setMessage('서버 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkStatus();
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();

        const trimmedCode = code.trim();
        if (!trimmedCode) {
            setMessage('인증코드를 입력해 주세요.');
            return;
        }

        if (!guardMissingHcaptcha('gatekeeper', hcaptchaEnabled, hcaptchaToken, setMessage)) {
            return;
        }

        setSubmitting(true);
        setMessage('');

        try {
            const res = await fetch(`${API_BASE}/api/gatekeeper/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify({ code: trimmedCode, hcaptchaToken }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success) {
                setMessage(data.msg || '인증코드가 올바르지 않습니다.');
                setAllowed(false);
                return;
            }

            setAllowed(true);
            setCode('');
            setMessage('');
        } catch (error) {
            console.error('게이트키퍼 인증 실패:', error);
            setMessage('인증 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
            setAllowed(false);
        } finally {
            setSubmitting(false);
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    if (loading) {
        return (
            <div style={styles.page}>
                <div style={styles.card}>
                    <div style={styles.logo}>우공실</div>
                    <p style={styles.desc}>입장 상태를 확인하는 중입니다...</p>
                </div>
            </div>
        );
    }

    if (allowed) {
        return children;
    }

    return (
        <div style={styles.page}>
            <form style={styles.card} onSubmit={handleSubmit}>
                <div style={styles.logo}>우공실</div>
                <h1 style={styles.title}>입장 인증</h1>
                <p style={styles.desc}>
                    우공실은 팀원 전용 학습 사이트입니다.
                    <br />
                    전달받은 인증코드를 입력해 주세요.
                </p>

                <input
                    type="password" value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="인증코드 입력" autoComplete="off" style={styles.input}
                    disabled={submitting}
                />

                {message ? <div style={styles.message}>{message}</div> : null}

                <HCaptchaBox
                    actionLabel="우공실 입장 보안 확인" onTokenChange={setHcaptchaToken}
                    onEnabledChange={setHcaptchaEnabled}
                    resetKey={hcaptchaResetKey}
                />

                <button type="submit" style={styles.button} disabled={submitting}>
                    {submitting ? '확인 중...' : '입장하기'}
                </button>
            </form>
        </div>
    );
}

const styles = {
    page: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f7efe2 0%, #eef4ff 100%)',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'Pretendard, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    },
    card: {
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(15,23,42,0.08)',
        borderRadius: '24px',
        boxShadow: '0 24px 80px rgba(15,23,42,0.16)',
        padding: '34px 28px',
        textAlign: 'center',
        boxSizing: 'border-box',
    },
    logo: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '92px',
        height: '42px',
        padding: '0 16px',
        borderRadius: '999px',
        background: '#111827',
        color: '#fff',
        fontWeight: 800,
        letterSpacing: '-0.04em',
        marginBottom: '20px',
    },
    title: {
        margin: '0 0 10px',
        fontSize: '26px',
        lineHeight: 1.25,
        color: '#111827',
        letterSpacing: '-0.04em',
    },
    desc: {
        margin: '0 0 24px',
        fontSize: '15px',
        lineHeight: 1.7,
        color: '#4b5563',
    },
    input: {
        width: '100%',
        height: '50px',
        borderRadius: '14px',
        border: '1px solid #d1d5db',
        padding: '0 16px',
        fontSize: '16px',
        outline: 'none',
        boxSizing: 'border-box',
        marginBottom: '12px',
        background: '#fff',
    },
    message: {
        margin: '2px 0 14px',
        padding: '10px 12px',
        borderRadius: '12px',
        background: '#fff1f2',
        color: '#be123c',
        fontSize: '14px',
        lineHeight: 1.45,
    },
    button: {
        width: '100%',
        height: '50px',
        border: 0,
        borderRadius: '14px',
        background: '#2563eb',
        color: '#fff',
        fontSize: '16px',
        fontWeight: 800,
        cursor: 'pointer',
        boxShadow: '0 12px 24px rgba(37,99,235,0.28)',
    },
};
