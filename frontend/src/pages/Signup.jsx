// 회원가입 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import HCaptchaBox from '../components/HCaptchaBox';
import { guardMissingHcaptcha } from '../hcaptchaGuard';
import useScreenSettings from '../useScreenSettings';

const API_BASE = "";

// 회원가입 화면 구성
// 역할:
// 1. 회원가입 입력값, 중복확인, 이메일 인증, 비밀번호 검증 로직을 담당합니다.
// 2. /login 탭 안에서 내장 모드로 호출될 때는 기존 기능은 유지하고
//  로그인 센터 폭에 맞는 넓은 폼 크기만 적용합니다.
// 3. 단독 회원가입 화면으로 호출될 가능성을 고려해 일반 모드 스타일도 유지합니다.

const Signup = ({ embedded = false }) => {
    const navigate = useNavigate();
    const { getSetting } = useScreenSettings('signup');
    const [form, setForm] = useState({
        id: '',
        password: '',
        passwordConfirm: '',
        name: '',
        email: '', 
        verificationCode: ''
    });
    
    const [isIdChecked, setIsIdChecked] = useState(false);
    const [showPw, setShowPw] = useState(false);
    const [showPwConfirm, setShowPwConfirm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hcaptchaToken, setHcaptchaToken] = useState('');
    const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
    const [hcaptchaResetKey, setHcaptchaResetKey] = useState(0);

    const [isEmailSent, setIsEmailSent] = useState(false);
    const [isEmailVerified, setIsEmailVerified] = useState(false);
    const [timer, setTimer] = useState(0); 
    const [resendTimer, setResendTimer] = useState(0); 

    useEffect(() => {
        let interval;
        if (timer >0) interval = setInterval(() => setTimer(prev => prev - 1), 1000);
        else if (timer === 0) clearInterval(interval);
        return () => clearInterval(interval);
    }, [timer]);

    useEffect(() => {
        let interval;
        if (resendTimer >0) interval = setInterval(() => setResendTimer(prev => prev - 1), 1000);
        else if (resendTimer === 0) clearInterval(interval);
        return () => clearInterval(interval);
    }, [resendTimer]);

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm({ ...form, [name]: value });
        if (name === 'id') setIsIdChecked(false);
        if (name === 'email') {
            setIsEmailSent(false);
            setIsEmailVerified(false);
            setTimer(0);
            setResendTimer(0);
            setForm(prev => ({ ...prev, verificationCode: '' }));
        }
    };

    const handleCheckId = async () => {
        if (!form.id.trim()) return alert(getSetting('messages.need_id', '확인할 아이디를 입력해주세요.'));
        const idRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{5,10}$/;
        if (!idRegex.test(form.id)) {
            setIsIdChecked(false);
            return alert(getSetting('messages.invalid_id', '아이디는 영문자와 숫자가 각각 1개 이상 포함된 5~10자리여야 합니다.'));
        }
        try {
            const res = await axios.post(`${API_BASE}/api/check-id`, { id: form.id });
            if (res.data.success || res.status === 200) {
                alert(getSetting('messages.id_available', '사용 가능한 아이디입니다.'));
                setIsIdChecked(true);
            }
        } catch (err) {
            setIsIdChecked(false);
            alert(err.response?.data?.msg || getSetting('messages.id_check_failed', '이미 사용 중인 아이디이거나 확인에 실패했습니다.'));
        }
    };

    const handleSendCode = async () => {
        if (!form.email.includes('@')) return alert(getSetting('messages.invalid_email', '올바른 이메일 형식을 입력해주세요.'));
        if (resendTimer >0) return alert(getSetting('messages.resend_wait', '{seconds}초 후에 다시 전송할 수 있습니다.').replace('{seconds}', String(resendTimer)));
        if (!guardMissingHcaptcha('auth_send_code', hcaptchaEnabled, hcaptchaToken)) return;

        try {
            //  타입 지정: 회원가입 용도
            const res = await axios.post(`${API_BASE}/api/auth/send-code`, { email: form.email, type: 'signup', hcaptchaToken });
            if (res.data.success) {
                alert(isEmailSent ? getSetting('messages.code_resent', '인증번호가 재전송되었습니다. 메일함을 확인해주세요.') : getSetting('messages.code_sent', '인증번호가 전송되었습니다. (유효시간 2분)'));
                setIsEmailSent(true);
                setTimer(120);       
                setResendTimer(30);  
            }
        } catch (err) {
            alert(err.response?.data?.msg || getSetting('messages.code_send_failed', '인증번호 전송에 실패했습니다.'));
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    const handleVerifyCode = async () => {
        if (timer === 0) return alert(getSetting('messages.code_expired', '인증 시간이 만료되었습니다. 인증번호를 재전송 해주세요.'));
        if (!form.verificationCode.trim()) return alert(getSetting('messages.need_code', '인증번호를 입력해주세요.'));

        try {
            const res = await axios.post(`${API_BASE}/api/auth/verify-code`, { 
                email: form.email, code: form.verificationCode 
            });
            if (res.data.success) {
                alert(getSetting('messages.email_verified', '이메일 인증이 완료되었습니다.'));
                setIsEmailVerified(true);
                setTimer(0);
                setResendTimer(0);
            }
        } catch (err) {
            alert(err.response?.data?.msg || getSetting('messages.code_mismatch', '인증번호가 일치하지 않습니다.'));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!isIdChecked) return alert(getSetting('messages.need_id_check', '아이디 중복 확인을 해주세요.'));
        if (!isEmailVerified) return alert(getSetting('messages.need_email_verify', '이메일 인증을 완료해주세요.'));
        if (!guardMissingHcaptcha('signup', hcaptchaEnabled, hcaptchaToken)) return;

        const pwRegex = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[@!,._-])[a-zA-Z0-9@!,._-]{8,15}$/;
        if (!pwRegex.test(form.password)) {
            return alert(getSetting('messages.invalid_password', '비밀번호는 영문, 숫자, 지정된 특수문자(@, !, ,, ., -, _)가 모두 포함된 8~15자리여야 합니다.'));
        }

        if (form.password !== form.passwordConfirm) {
            return alert(getSetting('messages.password_mismatch', '비밀번호가 일치하지 않습니다. 다시 확인해주세요.'));
        }

        setIsSubmitting(true);

        try {
            const res = await axios.post(`${API_BASE}/api/signup`, {
                id: form.id, password: form.password, name: form.name, email: form.email, hcaptchaToken
            });
            
            if (res.status === 200 || res.status === 201 || res.data.success) {
                alert(getSetting('messages.signup_success', '회원가입이 완료되었습니다!\n가입하신 이메일로 가입 환영 메일이 발송되었습니다.'));
                navigate('/');
            }
        } catch (err) {
            alert(err.response?.data?.msg || getSetting('messages.signup_failed', '회원가입에 실패했습니다.'));
        } finally {
            setIsSubmitting(false);
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    const isPwMatched = form.password && form.passwordConfirm && form.password === form.passwordConfirm;
    const isPwMismatched = form.passwordConfirm && form.password !== form.passwordConfirm;

    // 로그인 센터 탭 안에서는 넓어진 페이지 폭에 맞춰 폼의 기본 폭만 키웁니다.
    // 입력 검증, API 호출, 인증번호 처리 로직은 아래 JSX에서 그대로 사용합니다.
    const containerStyle = embedded
        ? { width: 'min(760px, 100%)', maxWidth: '760px', margin: '0 auto', background: 'transparent', padding: '0', borderRadius: '0', color: 'white', boxShadow: 'none' }
        : { maxWidth: '500px', margin: '50px auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', color: 'white', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' };

    const handleCancel = () => {
        // 로그인 페이지 탭 안에서 취소하면 로그인 탭으로 돌아가도록 /login으로 보냅니다.
        // 단독 회원가입 페이지에서는 현재 방식과 동일하게 이전 페이지로 돌아갑니다.
        if (embedded) navigate('/login');
        else navigate(-1);
    };

    return (
        <div className={embedded ? 'wgs-signup-embedded' : 'wgs-signup-standalone'} style={containerStyle}>
            <h2 style={{ textAlign: 'center', color: 'var(--wgs-title)', marginBottom: '30px' }}>{getSetting('form.title', '회원가입')}</h2>
            
            {/* 회원가입 폼 블록: 기존 입력 순서와 API 로직은 유지하고, 내장 모드 전용 CSS로 크기만 보강합니다. */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
                        {getSetting('form.id_label', '아이디 (영문+숫자 5~10자)')}
                        <span style={{ marginLeft: '10px', fontSize: '12px', color: isIdChecked ? '#10b981' : '#ef4444' }}>
                            {isIdChecked ? getSetting('form.id_checked_label', '확인완료') : getSetting('form.id_need_check_label', '*중복확인 필요')}
                        </span>
                    </label>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                        <input type="text" name="id" value={form.id} onChange={handleChange} required placeholder={getSetting('form.id_placeholder', '영문, 숫자 혼합 5~10자')} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} />
                        <button type="button" onClick={handleCheckId} style={{ padding: '0 15px', background: isIdChecked ? '#10b981' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{getSetting('form.id_check_button', '중복확인')}</button>
                    </div>
                </div>

                <div>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                        {getSetting('form.email_label', '이메일 주소')}
                        {isEmailVerified && <span style={{ color: '#10b981', fontSize: '12px' }}>{getSetting('form.email_verified_label', '인증완료')}</span>}
                    </label>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                        <input type="email" name="email" value={form.email} onChange={handleChange} required placeholder="example@daum.net" disabled={isEmailVerified} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: isEmailVerified ? 'var(--wgs-practice-toggle-bg)' : 'var(--wgs-input-bg)', color: isEmailVerified ? 'var(--wgs-subtle)' : 'white' }} />
                        <button type="button" onClick={handleSendCode} disabled={isEmailVerified || resendTimer >0} style={{ padding: '0 15px', background: isEmailVerified ? 'var(--wgs-border)' : (resendTimer >0 ? 'var(--wgs-border)' : (isEmailSent ? '#f59e0b' : '#10b981')), color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'}}>
                            {resendTimer >0 ? getSetting('form.resend_count_label', '{seconds}초').replace('{seconds}', String(resendTimer)) : (isEmailSent ? getSetting('form.resend_button', '재전송') : getSetting('form.send_code_button', '인증요청'))}
                        </button>
                    </div>
                </div>

                <HCaptchaBox
                    actionLabel={getSetting('form.hcaptcha_label', '회원가입/인증메일 보안 확인')} onTokenChange={setHcaptchaToken}
                    onEnabledChange={setHcaptchaEnabled}
                    resetKey={hcaptchaResetKey}
                />

                {isEmailSent && !isEmailVerified && (
                    <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
                        <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                            {getSetting('form.code_label', '인증번호 입력')}
                            <span style={{ color: timer >30 ? '#ef4444' : '#f87171', fontWeight: 'bold' }}>{getSetting('form.remaining_time_label', '남은시간')} {formatTime(timer)}</span>
                        </label>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                            <input type="text" name="verificationCode" value={form.verificationCode} onChange={handleChange} placeholder={getSetting('form.code_placeholder', '숫자 6자리 입력')} maxLength={6} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white', letterSpacing: '2px', textAlign: 'center', fontSize: '16px' }} />
                            <button type="button" onClick={handleVerifyCode} style={{ padding: '0 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{getSetting('form.confirm_button', '확인')}</button>
                        </div>
                    </div>
                )}

                <div>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px' }}>{getSetting('form.password_label', '비밀번호 (영문+숫자+기호 8~15자)')}</label>
                    <div style={{ position: 'relative', marginTop: '5px' }}>
                        <input type={showPw ? "text" : "password"} name="password" value={form.password} onChange={handleChange} required placeholder={getSetting('form.password_placeholder', '영문, 숫자, 기호(@!.,-_) 포함 8~15자')} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', paddingRight: '45px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} />
                        <button type="button" onClick={() => setShowPw(!showPw)} title={showPw ? getSetting('form.hide_password_title', '숨기기') : getSetting('form.show_password_title', '표시')} style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--wgs-subtle)', cursor: 'pointer', fontSize: '18px' }}>
                            {showPw ? getSetting('form.hide_password_label', '숨김') : getSetting('form.show_password_label', '보기')}
                        </button>
                    </div>
                </div>

                <div>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
                        {getSetting('form.password_confirm_label', '비밀번호 확인')}
                        {isPwMatched && <span style={{ color: '#10b981', fontSize: '12px' }}>{getSetting('form.password_match_label', '일치합니다')}</span>}
                        {isPwMismatched && <span style={{ color: '#ef4444', fontSize: '12px' }}>{getSetting('form.password_mismatch_label', '일치하지 않습니다')}</span>}
                    </label>
                    <div style={{ position: 'relative', marginTop: '5px' }}>
                        <input type={showPwConfirm ? "text" : "password"} name="passwordConfirm" value={form.passwordConfirm} onChange={handleChange} required placeholder={getSetting('form.password_confirm_placeholder', '비밀번호를 한번 더 입력해주세요')} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', paddingRight: '45px', borderRadius: '8px', border: `1px solid ${isPwMatched ? '#10b981' : isPwMismatched ? '#ef4444' : 'var(--wgs-border)'}`, background: 'var(--wgs-input-bg)', color: 'white' }} />
                        <button type="button" onClick={() => setShowPwConfirm(!showPwConfirm)} title={showPwConfirm ? getSetting('form.hide_password_title', '숨기기') : getSetting('form.show_password_title', '표시')} style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--wgs-subtle)', cursor: 'pointer', fontSize: '18px' }}>
                            {showPwConfirm ? getSetting('form.hide_password_label', '숨김') : getSetting('form.show_password_label', '보기')}
                        </button>
                    </div>
                </div>

                <div>
                    <label style={{ color: 'var(--wgs-muted)', fontSize: '14px' }}>{getSetting('form.name_label', '이름')}</label>
                    <input type="text" name="name" value={form.name} onChange={handleChange} required placeholder={getSetting('form.name_placeholder', '홍길동')} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white', marginTop: '5px' }} />
                </div>
                
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button type="button" onClick={handleCancel} disabled={isSubmitting} style={{ flex: 1, padding: '15px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px' }}>{getSetting('form.cancel_button', '취소')}</button>
                    <button type="submit" disabled={isSubmitting} style={{ flex: 1, padding: '15px', background: isSubmitting ? '#2563eb' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                        {isSubmitting ? getSetting('form.submit_loading_label', '처리 중...') : getSetting('form.submit_button', '가입완료')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Signup;
