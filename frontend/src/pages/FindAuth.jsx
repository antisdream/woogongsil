// 계정 찾기 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import HCaptchaBox from '../components/HCaptchaBox';
import { guardMissingHcaptcha } from '../hcaptchaGuard';

const API_BASE = ""; 

// 계정 찾기 화면 구성
// 역할:
// 1. 아이디 찾기와 비밀번호 찾기를 같은 컴포넌트 안에서 탭으로 처리합니다.
// 2. 이름/아이디 + 이메일 인증 후 결과 조회 또는 비밀번호 재설정을 수행합니다.
// 3. /login 탭 안에서 내장 모드로 호출될 때는 기존 로직은 유지하고
//  로그인 센터 폭에 맞게 폼 크기와 여백만 키웁니다.

const FindAuth = ({ embedded = false, loginPath = '/login' }) => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('id'); // 'id' 또는 'pw'
    
    // 두 탭 모두 공통적으로 이메일 인증 스텝을 거칩니다.
    const [step, setStep] = useState(1);
    const [form, setForm] = useState({
        name: '',
        email: '',
        id: '', 
        newPassword: '',
        confirmPassword: ''
    });

    const [verificationCode, setVerificationCode] = useState('');
    const [foundId, setFoundId] = useState('');
    
    const [isEmailSent, setIsEmailSent] = useState(false);
    const [hcaptchaToken, setHcaptchaToken] = useState('');
    const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
    const [hcaptchaResetKey, setHcaptchaResetKey] = useState(0);
    const [timer, setTimer] = useState(0);

    // 탭 변경 시 상태 초기화
    const resetState = (targetTab) => {
        setActiveTab(targetTab);
        setStep(1);
        setFoundId('');
        setIsEmailSent(false);
        setTimer(0);
        setVerificationCode('');
        setForm({ name: '', email: '', id: '', newPassword: '', confirmPassword: '' });
    };

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

    // 공통: 인증번호 발송 (탭에 따라 검사 항목 다름)
    const handleSendCode = async () => {
        if (activeTab === 'id') {
            if (!form.name || !form.email) return alert("이름과 이메일을 모두 입력해주세요.");
        } else {
            if (!form.id || !form.email) return alert("아이디와 이메일을 모두 입력해주세요.");
        }
        if (!guardMissingHcaptcha('find_reset', hcaptchaEnabled, hcaptchaToken)) return;

        try {
            const res = await axios.post(`${API_BASE}/api/auth/send-code`, {
                email: form.email, type: 'find', hcaptchaToken
            });
            if (res.data.success) {
                alert("인증번호가 발송되었습니다. (2분 내 입력)");
                setIsEmailSent(true);
                setTimer(120);
            }
        } catch (err) {
            alert(err.response?.data?.msg || "일치하는 회원 정보가 없거나 메일 발송에 실패했습니다.");
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    // 공통: 인증번호 확인
    const handleVerifyCode = async () => {
        if (timer === 0) return alert("인증 시간이 만료되었습니다.");
        if (!verificationCode) return alert("인증번호를 입력해주세요.");

        try {
            const res = await axios.post(`${API_BASE}/api/auth/verify-code`, {
                email: form.email, code: verificationCode
            });
            if (res.data.success) {
                setTimer(0);
                
                // 인증 성공 후, 아이디 찾기면 즉시 서버에 ID 요청
                if (activeTab === 'id') {
                    fetchFoundId();
                } else {
                    // 비밀번호 찾기면 다음 스텝(새 비번 입력창)으로 이동
                    alert("인증 성공! 새로운 비밀번호를 설정하세요.");
                    setStep(2);
                }
            }
        } catch (err) {
            alert("인증번호가 일치하지 않습니다.");
        }
    };

    // 아이디 찾기 처리합니다
    const fetchFoundId = async () => {
        try {
            const res = await axios.post(`${API_BASE}/api/find-id`, {
                name: form.name, email: form.email
            });
            if (res.data.success) {
                setFoundId(res.data.id);
                setStep(2); // 결과 화면
            }
        } catch (err) {
            alert(err.response?.data?.msg || "계정을 찾지 못했습니다.");
            resetState('id');
        }
    };

    // 비밀번호 최종 변경 처리합니다
    const handleResetPw = async (e) => {
        e.preventDefault();
        const pwRegex = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[@!,._-])[a-zA-Z0-9@!,._-]{8,15}$/;
        if (!pwRegex.test(form.newPassword)) {
            return alert("비밀번호는 영문, 숫자, 기호(@!.,-_) 포함 8~15자여야 합니다.");
        }
        if (form.newPassword !== form.confirmPassword) {
            return alert("비밀번호가 일치하지 않습니다.");
        }
        if (!guardMissingHcaptcha('find_reset', hcaptchaEnabled, hcaptchaToken)) return;

        try {
            const res = await axios.post(`${API_BASE}/api/find-pw/reset`, {
                id: form.id, newPassword: form.newPassword, hcaptchaToken
            });
            if (res.data.success) {
                alert("비밀번호가 성공적으로 변경되었습니다. 새로운 비밀번호로 로그인해주세요.");
                navigate(loginPath);
            }
        } catch (err) {
            alert("변경에 실패했습니다.");
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    // 아이디/비밀번호 찾기 내부 탭 스타일입니다.
    // 내장 모드에서는 넓어진 로그인 센터에 맞춰 글자와 버튼 높이만 키웁니다.
    const tabStyle = (target) => ({
        flex: 1,
        padding: embedded ? '18px 16px' : '15px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: embedded ? '17px' : '16px',
        borderRadius: '8px 8px 0 0',
        background: activeTab === target ? '#3b82f6' : 'var(--wgs-border)',
        color: 'white',
        transition: '0.3s'
    });

    // 공통 입력칸 스타일입니다.
    // API 검증 로직과 name 값은 그대로 두고, 화면 크기만 내장 모드 기준으로 확장합니다.
    const inputStyle = {
        width: '100%',
        padding: embedded ? '16px' : '12px',
        boxSizing: 'border-box',
        borderRadius: embedded ? '12px' : '8px',
        border: '1px solid var(--wgs-border)',
        background: 'var(--wgs-input-bg)',
        color: 'white',
        fontSize: embedded ? '16px' : '14px',
        minHeight: embedded ? '56px' : 'auto'
    };

    // 로그인 센터 탭 안에서는 폭을 넓혀 과한 빈 여백을 줄이고,
    // 단독 페이지로 호출되는 경우에는 기존 폭을 유지합니다.
    const containerStyle = embedded
        ? { width: 'min(760px, 100%)', maxWidth: '760px', margin: '0 auto', background: 'transparent', padding: '0', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--wgs-border)', boxShadow: 'none' }
        : { maxWidth: '450px', margin: '40px auto', background: '#1e2433', padding: '0', borderRadius: '15px', overflow: 'hidden', border: '1px solid var(--wgs-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' };

    const contentPadding = embedded ? '42px 52px' : '30px';

    return (
        <div className={embedded ? 'wgs-findauth-embedded' : 'wgs-findauth-standalone'} style={containerStyle}>
            {/* 아이디 찾기 / 비밀번호 찾기 내부 전환 탭입니다. */}
            <div style={{ display: 'flex' }}>
                <button style={tabStyle('id')} onClick={() => resetState('id')}>아이디 찾기</button>
                <button style={tabStyle('pw')} onClick={() => resetState('pw')}>비밀번호 찾기</button>
            </div>

            <div style={{ padding: contentPadding }}>
                {/* =========== 아이디 찾기 =========== */}
                {activeTab === 'id' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        {step === 1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <p style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px', margin: '0 0 10px 0', textAlign: 'center' }}>가입 시 등록한 이름과 이메일로 인증합니다.</p>
                                <input type="text" name="name" placeholder="가입자 이름" value={form.name} onChange={handleChange} disabled={isEmailSent} style={inputStyle} />
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="email" name="email" placeholder="가입 이메일" value={form.email} onChange={handleChange} disabled={isEmailSent} style={{ ...inputStyle, flex: 1 }} />
                                    <button onClick={handleSendCode} disabled={isEmailSent} style={{ padding: embedded ? '0 22px' : '0 15px', background: isEmailSent ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isEmailSent ? 'not-allowed' : 'pointer', fontWeight: 'bold', width: embedded ? '124px' : '100px' }}>
                                        {isEmailSent ? "전송완료" : "인증요청"}
                                    </button>
                                </div>

                                <HCaptchaBox
                                    actionLabel="아이디 찾기 보안 확인" onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />

                                {isEmailSent && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', padding: embedded ? '17px' : '15px', background: 'var(--wgs-input-bg)', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fcd34d', fontSize: embedded ? '16px' : '14px' }}>
                                            <span>인증번호 6자리</span>
                                            <span style={{ color: timer >30 ? '#ef4444' : '#f87171', fontWeight: 'bold' }}>{formatTime(timer)}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <input type="text" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="000000" style={{ ...inputStyle, textAlign: 'center', letterSpacing: '3px', fontSize: embedded ? '20px' : '18px' }} />
                                            <button onClick={handleVerifyCode} style={{ padding: embedded ? '0 24px' : '0 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>확인</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {step === 2 && foundId && (
                            <div style={{ textAlign: 'center', animation: 'fadeIn 0.5s' }}>
                                <h3 style={{ color: 'var(--wgs-title)', marginBottom: '20px' }}> 아이디를 찾았습니다!</h3>
                                <div style={{ background: 'var(--wgs-input-bg)', padding: '20px', borderRadius: '8px', fontSize: '22px', fontWeight: 'bold', color: '#10b981', border: '1px solid #3b82f6', marginBottom: '25px' }}>
                                    {foundId}
                                </div>
                                <button onClick={() => navigate(loginPath)} style={{ width: '100%', padding: embedded ? '17px' : '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: embedded ? '17px' : '16px' }}>로그인 화면으로 이동</button>
                            </div>
                        )}
                    </div>
                )}

                {/* =========== 비밀번호 찾기 =========== */}
                {activeTab === 'pw' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        {step === 1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <p style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px', margin: '0 0 10px 0', textAlign: 'center' }}>아이디와 이메일로 본인 인증 후 재설정합니다.</p>
                                <input type="text" name="id" placeholder="아이디" value={form.id} onChange={handleChange} disabled={isEmailSent} style={inputStyle} />
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="email" name="email" placeholder="가입 이메일" value={form.email} onChange={handleChange} disabled={isEmailSent} style={{ ...inputStyle, flex: 1 }} />
                                    <button onClick={handleSendCode} disabled={isEmailSent} style={{ padding: embedded ? '0 22px' : '0 15px', background: isEmailSent ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isEmailSent ? 'not-allowed' : 'pointer', fontWeight: 'bold', width: embedded ? '124px' : '100px' }}>
                                        {isEmailSent ? "전송완료" : "인증요청"}
                                    </button>
                                </div>

                                <HCaptchaBox
                                    actionLabel="비밀번호 찾기 보안 확인" onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />

                                {isEmailSent && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', padding: embedded ? '17px' : '15px', background: 'var(--wgs-input-bg)', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fcd34d', fontSize: embedded ? '16px' : '14px' }}>
                                            <span>인증번호 6자리</span>
                                            <span style={{ color: timer >30 ? '#ef4444' : '#f87171', fontWeight: 'bold' }}>{formatTime(timer)}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <input type="text" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="000000" style={{ ...inputStyle, textAlign: 'center', letterSpacing: '3px', fontSize: embedded ? '20px' : '18px' }} />
                                            <button onClick={handleVerifyCode} style={{ padding: embedded ? '0 24px' : '0 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>확인</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {step === 2 && (
                            <form onSubmit={handleResetPw} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', color: '#10b981', marginBottom: '10px', fontWeight: 'bold' }}>
                                     이메일 본인 인증이 완료되었습니다.
                                </div>
                                <div>
                                    <label style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px' }}>새로운 비밀번호</label>
                                    <input type="password" name="newPassword" placeholder="영문, 숫자, 기호 포함 8~15자" onChange={handleChange} required style={{ ...inputStyle, marginTop: '5px' }} />
                                </div>
                                <div>
                                    <label style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px' }}>비밀번호 확인</label>
                                    <input type="password" name="confirmPassword" placeholder="새 비밀번호 재입력" onChange={handleChange} required style={{ ...inputStyle, marginTop: '5px' }} />
                                </div>
                                <HCaptchaBox
                                    actionLabel="비밀번호 재설정 보안 확인" onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />

                                <button type="submit" style={{ width: '100%', padding: embedded ? '17px' : '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: embedded ? '17px' : '16px', marginTop: '10px' }}>
                                    비밀번호 변경하기
                                </button>
                            </form>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FindAuth;
