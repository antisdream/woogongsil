// 비밀번호 변경 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect } from 'react';
import HCaptchaBox from '../components/HCaptchaBox';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { guardMissingHcaptcha } from '../hcaptchaGuard';

const ChangePW = () => {
    const navigate = useNavigate();
    const userId = sessionStorage.getItem('userId');
    const [form, setForm] = useState({
        email: '',
        verificationCode: '',
        newPw: '',
        confirmPw: ''
    });

    const [showNewPw, setShowNewPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);
    const [hcaptchaToken, setHcaptchaToken] = useState('');
    const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
    const [hcaptchaResetKey, setHcaptchaResetKey] = useState(0);
    const [isEmailSent, setIsEmailSent] = useState(false);
    const [isEmailVerified, setIsEmailVerified] = useState(false);
    const [timer, setTimer] = useState(0);

    useEffect(() => {
        if (!userId) {
            alert("로그인이 필요한 서비스입니다.");
            navigate('/');
        }
    }, [userId, navigate]);

    useEffect(() => {
        let interval;
        if (timer >0) interval = setInterval(() => setTimer(prev => prev - 1), 1000);
        else if (timer === 0) clearInterval(interval);
        return () => clearInterval(interval);
    }, [timer]);

    const formatTime = (sec) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    //   현재 비밀번호나 힌트 대신 가입한 이메일로 본인 인증
    const handleSendCode = async () => {
        if (!form.email) return alert("가입 시 등록한 이메일을 입력해주세요.");
        if (!guardMissingHcaptcha('change_pw', hcaptchaEnabled, hcaptchaToken)) return;
        try {
            const API_BASE = "";
            const res = await axios.post(`${API_BASE}/api/auth/send-code`, { email: form.email, type: 'change', hcaptchaToken });
            if (res.data.success) {
                alert("인증번호가 발송되었습니다. (유효시간 2분)\n가입된 이메일이 맞는지 확인해주세요.");
                setIsEmailSent(true);
                setTimer(120);
            }
        } catch (err) {
            alert(err.response?.data?.msg || "메일 전송에 실패했습니다. 이메일을 다시 확인해주세요.");
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    const handleVerifyCode = async () => {
        if (timer === 0) return alert("인증 시간이 만료되었습니다.");
        if (!form.verificationCode) return alert("인증번호를 입력해주세요.");
        try {
            const API_BASE = "";
            const res = await axios.post(`${API_BASE}/api/auth/verify-code`, { email: form.email, code: form.verificationCode });
            if (res.data.success) {
                alert("본인 인증이 완료되었습니다. 새 비밀번호를 설정해주세요.");
                setIsEmailVerified(true);
                setTimer(0);
            }
        } catch (err) {
            alert("인증번호가 일치하지 않습니다.");
        }
    };

    const handleUpdatePw = async (e) => {
        e.preventDefault();

        if (!isEmailVerified) return alert("이메일 본인 인증을 먼저 완료해주세요.");
        if (!guardMissingHcaptcha('change_pw', hcaptchaEnabled, hcaptchaToken)) return;

        const pwRegex = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[@!,._-])[a-zA-Z0-9@!,._-]{8,15}$/;
        if (!pwRegex.test(form.newPw)) {
            return alert("비밀번호는 영문, 숫자, 기호(@, !, ,, ., -, _)가 모두 포함된 8~15자리여야 합니다.");
        }

        if (form.newPw !== form.confirmPw) {
            return alert("새 비밀번호가 일치하지 않습니다.");
        }
        
        try {
            const API_BASE = "";
            const res = await axios.post(`${API_BASE}/api/user/change-pw`, {
                id: userId, newPw: form.newPw, hcaptchaToken 
            });
            if (res.data.success) {
                alert("비밀번호가 안전하게 변경되었습니다. 새로운 비밀번호로 다시 로그인해주세요.");
                sessionStorage.clear();
                window.location.href = '/';
            }
        } catch (err) {
            alert(err.response?.data?.msg || "비밀번호 변경에 실패했습니다.");
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    return (
        <div style={{ maxWidth: '500px', margin: '50px auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', color: 'white', border: '1px solid var(--wgs-border)', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
            <h2 style={{ textAlign: 'center', color: 'var(--wgs-title)', marginBottom: '30px' }}>비밀번호 변경 (본인 인증)</h2>
            
            <form onSubmit={handleUpdatePw} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* 1단계: 이메일 인증 */}
                <div style={{ paddingBottom: '20px', borderBottom: '1px solid var(--wgs-border)' }}>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                        가입된 이메일 주소
                        {isEmailVerified && <span style={{ color: '#10b981', fontSize: '12px' }}>인증완료</span>}
                    </label>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                        <input type="email" name="email" value={form.email} onChange={handleChange} disabled={isEmailVerified} placeholder="계정에 등록된 이메일 입력"required style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: isEmailVerified ? 'var(--wgs-practice-toggle-bg)' : 'var(--wgs-input-bg)', color: isEmailVerified ? 'var(--wgs-subtle)' : 'white' }} />
                        <button type="button" onClick={handleSendCode} disabled={isEmailVerified} style={{ padding: '0 15px', background: isEmailVerified ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isEmailVerified ? 'not-allowed' : 'pointer', fontWeight: 'bold', width: '90px' }}>
                            {isEmailSent ? "재전송" : "인증요청"}
                        </button>
                    </div>

                    {isEmailSent && !isEmailVerified && (
                        <div style={{ marginTop: '15px', animation: 'fadeIn 0.3s' }}>
                            <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                                인증번호 입력 
                                <span style={{ color: timer >30 ? '#ef4444' : '#f87171', fontWeight: 'bold' }}>남은시간 {formatTime(timer)}</span>
                            </label>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                <input type="text" name="verificationCode" value={form.verificationCode} onChange={handleChange} placeholder="숫자 6자리" maxLength={6} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white', textAlign: 'center', letterSpacing: '2px', fontSize: '16px' }} />
                                <button type="button" onClick={handleVerifyCode} style={{ padding: '0 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>확인</button>
                            </div>
                        </div>
                    )}
                </div>

                <HCaptchaBox
                    actionLabel="비밀번호 변경/인증메일 보안 확인" onTokenChange={setHcaptchaToken}
                    onEnabledChange={setHcaptchaEnabled}
                    resetKey={hcaptchaResetKey}
                />

                {/* 2단계: 새 비밀번호 설정 (인증 완료 시에만 활성화) */}
                <div style={{ opacity: isEmailVerified ? 1 : 0.4, pointerEvents: isEmailVerified ? 'auto' : 'none', transition: '0.3s' }}>
                    <div>
                        <label style={{ color: 'var(--wgs-muted)', fontSize: '14px' }}>새 비밀번호 (영문+숫자+기호 8~15자)</label>
                        <div style={{ position: 'relative', marginTop: '5px' }}>
                            <input type={showNewPw ? "text" : "password"} name="newPw" value={form.newPw} onChange={handleChange} required disabled={!isEmailVerified} placeholder="새로운 비밀번호 입력" style={{ width: '100%', boxSizing: 'border-box', padding: '12px', paddingRight: '45px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} />
                            <button type="button" onClick={() => setShowNewPw(!showNewPw)} style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--wgs-subtle)', cursor: 'pointer', fontSize: '18px' }}>
                                {showNewPw ? "숨김" : "보기"}
                            </button>
                        </div>
                    </div>

                    <div style={{ marginTop: '15px' }}>
                        <label style={{ color: 'var(--wgs-muted)', fontSize: '14px' }}>새 비밀번호 확인</label>
                        <div style={{ position: 'relative', marginTop: '5px' }}>
                            <input type={showConfirmPw ? "text" : "password"} name="confirmPw" value={form.confirmPw} onChange={handleChange} required disabled={!isEmailVerified} placeholder="비밀번호 재입력" style={{ width: '100%', boxSizing: 'border-box', padding: '12px', paddingRight: '45px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} />
                            <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--wgs-subtle)', cursor: 'pointer', fontSize: '18px' }}>
                                {showConfirmPw ? "숨김" : "보기"}
                            </button>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button type="button" onClick={() => navigate(-1)} style={{ flex: 1, padding: '15px', borderRadius: '8px', background: 'var(--wgs-border)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>취소</button>
                    <button type="submit" disabled={!isEmailVerified} style={{ flex: 1, padding: '15px', borderRadius: '8px', background: isEmailVerified ? '#3b82f6' : '#1e3a8a', color: isEmailVerified ? 'white' : 'var(--wgs-subtle)', border: 'none', cursor: isEmailVerified ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '15px' }}>
                        변경 완료
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ChangePW;
