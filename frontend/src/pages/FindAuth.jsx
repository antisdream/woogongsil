// Account recovery page. API flow stays in code; operator-facing copy comes from wgs_screen_settings.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import HCaptchaBox from '../components/HCaptchaBox';
import { guardMissingHcaptcha } from '../hcaptchaGuard';
import useScreenSettings from '../useScreenSettings';

const API_BASE = '';

const FindAuth = ({ embedded = false, loginPath = '/login' }) => {
    const navigate = useNavigate();
    const { getSetting } = useScreenSettings('find_auth');
    const t = (key, fallback) => getSetting(key, fallback);

    const [activeTab, setActiveTab] = useState('id');
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

    const resetState = (targetTab) => {
        setActiveTab(targetTab);
        setStep(1);
        setFoundId('');
        setIsEmailSent(false);
        setTimer(0);
        setVerificationCode('');
        setHcaptchaToken('');
        setHcaptchaResetKey((value) => value + 1);
        setForm({ name: '', email: '', id: '', newPassword: '', confirmPassword: '' });
    };

    useEffect(() => {
        let interval;
        if (timer > 0) interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
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

    const handleSendCode = async () => {
        if (activeTab === 'id') {
            if (!form.name || !form.email) {
                alert(t('messages.id_missing_inputs', '이름과 이메일을 모두 입력해주세요.'));
                return;
            }
        } else if (!form.id || !form.email) {
            alert(t('messages.pw_missing_inputs', '아이디와 이메일을 모두 입력해주세요.'));
            return;
        }

        if (!guardMissingHcaptcha('find_reset', hcaptchaEnabled, hcaptchaToken)) return;

        try {
            const res = await axios.post(`${API_BASE}/api/auth/send-code`, {
                email: form.email,
                type: 'find',
                hcaptchaToken
            });

            if (res.data.success) {
                alert(t('messages.code_sent', '인증번호가 발송되었습니다. 2분 안에 입력해주세요.'));
                setIsEmailSent(true);
                setTimer(120);
            }
        } catch (err) {
            alert(err.response?.data?.msg || t('messages.send_failed', '일치하는 회원 정보가 없거나 메일 발송에 실패했습니다.'));
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

    const fetchFoundId = async () => {
        try {
            const res = await axios.post(`${API_BASE}/api/find-id`, {
                name: form.name,
                email: form.email
            });

            if (res.data.success) {
                setFoundId(res.data.id);
                setStep(2);
            }
        } catch (err) {
            alert(err.response?.data?.msg || t('messages.id_fetch_failed', '계정을 찾을 수 없습니다.'));
            resetState('id');
        }
    };

    const handleVerifyCode = async () => {
        if (timer === 0) {
            alert(t('messages.code_expired', '인증 시간이 만료되었습니다.'));
            return;
        }
        if (!verificationCode) {
            alert(t('messages.need_code', '인증번호를 입력해주세요.'));
            return;
        }

        try {
            const res = await axios.post(`${API_BASE}/api/auth/verify-code`, {
                email: form.email,
                code: verificationCode
            });

            if (res.data.success) {
                setTimer(0);
                if (activeTab === 'id') {
                    fetchFoundId();
                } else {
                    alert(t('messages.pw_verified', '인증 성공! 새로운 비밀번호를 설정해주세요.'));
                    setStep(2);
                }
            }
        } catch (err) {
            alert(err.response?.data?.msg || t('messages.code_mismatch', '인증번호가 일치하지 않습니다.'));
        }
    };

    const handleResetPw = async (e) => {
        e.preventDefault();
        const pwRegex = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[@!,._-])[a-zA-Z0-9@!,._-]{8,15}$/;

        if (!pwRegex.test(form.newPassword)) {
            alert(t('messages.invalid_password', '비밀번호는 영문, 숫자, 기호(@!.,-_) 포함 8~15자여야 합니다.'));
            return;
        }
        if (form.newPassword !== form.confirmPassword) {
            alert(t('messages.password_mismatch', '비밀번호가 일치하지 않습니다.'));
            return;
        }
        if (!guardMissingHcaptcha('find_reset', hcaptchaEnabled, hcaptchaToken)) return;

        try {
            const res = await axios.post(`${API_BASE}/api/find-pw/reset`, {
                id: form.id,
                newPassword: form.newPassword,
                hcaptchaToken
            });

            if (res.data.success) {
                alert(t('messages.reset_success', '비밀번호가 성공적으로 변경되었습니다. 새로운 비밀번호로 로그인해주세요.'));
                navigate(loginPath);
            }
        } catch (err) {
            alert(err.response?.data?.msg || t('messages.reset_failed', '비밀번호 변경에 실패했습니다.'));
        } finally {
            setHcaptchaResetKey((value) => value + 1);
        }
    };

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

    const containerStyle = embedded
        ? { width: 'min(760px, 100%)', maxWidth: '760px', margin: '0 auto', background: 'transparent', padding: '0', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--wgs-border)', boxShadow: 'none' }
        : { maxWidth: '450px', margin: '40px auto', background: '#1e2433', padding: '0', borderRadius: '15px', overflow: 'hidden', border: '1px solid var(--wgs-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' };

    const contentPadding = embedded ? '42px 52px' : '30px';
    const sendButtonLabel = isEmailSent
        ? t('common.sent_label', '전송완료')
        : t('common.request_button', '인증요청');

    const renderCodeBox = () => isEmailSent && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', padding: embedded ? '17px' : '15px', background: 'var(--wgs-input-bg)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fcd34d', fontSize: embedded ? '16px' : '14px' }}>
                <span>{t('common.code_label', '인증번호 6자리')}</span>
                <span style={{ color: timer > 30 ? '#ef4444' : '#f87171', fontWeight: 'bold' }}>{formatTime(timer)}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
                <input
                    type="text"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder={t('common.code_placeholder', '000000')}
                    style={{ ...inputStyle, textAlign: 'center', letterSpacing: '3px', fontSize: embedded ? '20px' : '18px' }}
                />
                <button type="button" onClick={handleVerifyCode} style={{ padding: embedded ? '0 24px' : '0 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {t('common.confirm_button', '확인')}
                </button>
            </div>
        </div>
    );

    return (
        <div className={embedded ? 'wgs-findauth-embedded' : 'wgs-findauth-standalone'} style={containerStyle}>
            <div style={{ display: 'flex' }}>
                <button type="button" style={tabStyle('id')} onClick={() => resetState('id')}>{t('tabs.id_label', '아이디 찾기')}</button>
                <button type="button" style={tabStyle('pw')} onClick={() => resetState('pw')}>{t('tabs.pw_label', '비밀번호 찾기')}</button>
            </div>

            <div style={{ padding: contentPadding }}>
                {activeTab === 'id' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        {step === 1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <p style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px', margin: '0 0 10px 0', textAlign: 'center' }}>
                                    {t('id_step.desc', '가입할 때 등록한 이름과 이메일로 인증합니다.')}
                                </p>
                                <input type="text" name="name" placeholder={t('id_step.name_placeholder', '가입자 이름')} value={form.name} onChange={handleChange} disabled={isEmailSent} style={inputStyle} />
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="email" name="email" placeholder={t('common.email_placeholder', '가입 이메일')} value={form.email} onChange={handleChange} disabled={isEmailSent} style={{ ...inputStyle, flex: 1 }} />
                                    <button type="button" onClick={handleSendCode} disabled={isEmailSent} style={{ padding: embedded ? '0 22px' : '0 15px', background: isEmailSent ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isEmailSent ? 'not-allowed' : 'pointer', fontWeight: 'bold', width: embedded ? '124px' : '100px' }}>
                                        {sendButtonLabel}
                                    </button>
                                </div>
                                <HCaptchaBox
                                    actionLabel={t('id_step.hcaptcha_label', '아이디 찾기 보안 확인')}
                                    onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />
                                {renderCodeBox()}
                            </div>
                        )}
                        {step === 2 && foundId && (
                            <div style={{ textAlign: 'center', animation: 'fadeIn 0.5s' }}>
                                <h3 style={{ color: 'var(--wgs-title)', marginBottom: '20px' }}>{t('result.title', '아이디를 찾았습니다')}</h3>
                                <div style={{ background: 'var(--wgs-input-bg)', padding: '20px', borderRadius: '8px', fontSize: '22px', fontWeight: 'bold', color: '#10b981', border: '1px solid #3b82f6', marginBottom: '25px' }}>
                                    {foundId}
                                </div>
                                <button type="button" onClick={() => navigate(loginPath)} style={{ width: '100%', padding: embedded ? '17px' : '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: embedded ? '17px' : '16px' }}>
                                    {t('result.login_button', '로그인 화면으로 이동')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'pw' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        {step === 1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <p style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px', margin: '0 0 10px 0', textAlign: 'center' }}>
                                    {t('pw_step.desc', '아이디와 이메일로 본인 인증 후 재설정합니다.')}
                                </p>
                                <input type="text" name="id" placeholder={t('pw_step.id_placeholder', '아이디')} value={form.id} onChange={handleChange} disabled={isEmailSent} style={inputStyle} />
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="email" name="email" placeholder={t('common.email_placeholder', '가입 이메일')} value={form.email} onChange={handleChange} disabled={isEmailSent} style={{ ...inputStyle, flex: 1 }} />
                                    <button type="button" onClick={handleSendCode} disabled={isEmailSent} style={{ padding: embedded ? '0 22px' : '0 15px', background: isEmailSent ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: isEmailSent ? 'not-allowed' : 'pointer', fontWeight: 'bold', width: embedded ? '124px' : '100px' }}>
                                        {sendButtonLabel}
                                    </button>
                                </div>
                                <HCaptchaBox
                                    actionLabel={t('pw_step.hcaptcha_label', '비밀번호 찾기 보안 확인')}
                                    onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />
                                {renderCodeBox()}
                            </div>
                        )}
                        {step === 2 && (
                            <form onSubmit={handleResetPw} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', color: '#10b981', marginBottom: '10px', fontWeight: 'bold' }}>
                                    {t('reset.verified_notice', '이메일 본인 인증이 완료되었습니다.')}
                                </div>
                                <div>
                                    <label style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px' }}>{t('reset.new_password_label', '새 비밀번호')}</label>
                                    <input type="password" name="newPassword" value={form.newPassword} placeholder={t('reset.new_password_placeholder', '영문, 숫자, 기호 포함 8~15자')} onChange={handleChange} required style={{ ...inputStyle, marginTop: '5px' }} />
                                </div>
                                <div>
                                    <label style={{ color: 'var(--wgs-muted)', fontSize: embedded ? '16px' : '14px' }}>{t('reset.confirm_password_label', '비밀번호 확인')}</label>
                                    <input type="password" name="confirmPassword" value={form.confirmPassword} placeholder={t('reset.confirm_password_placeholder', '새 비밀번호 재입력')} onChange={handleChange} required style={{ ...inputStyle, marginTop: '5px' }} />
                                </div>
                                <HCaptchaBox
                                    actionLabel={t('reset.hcaptcha_label', '비밀번호 재설정 보안 확인')}
                                    onTokenChange={setHcaptchaToken}
                                    onEnabledChange={setHcaptchaEnabled}
                                    resetKey={hcaptchaResetKey}
                                />
                                <button type="submit" style={{ width: '100%', padding: embedded ? '17px' : '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: embedded ? '17px' : '16px', marginTop: '10px' }}>
                                    {t('reset.submit_button', '비밀번호 변경하기')}
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
