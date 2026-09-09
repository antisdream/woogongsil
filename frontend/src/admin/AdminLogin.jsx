import React, { useEffect, useState } from 'react';
import { FiArrowLeft, FiLock } from 'react-icons/fi';
import { makeAdminHeaders, setAdminSession } from './adminSession.js';

export default function AdminLogin({ onAuthenticated, initialMessage = '' }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const [restoring, setRestoring] = useState(true);
  const [retryAt, setRetryAt] = useState(0);

  function updatePending(data) {
    const receivedAt = Date.now();
    const offset = receivedAt - Date.parse(data.serverTime);
    setNow(receivedAt);
    setPending({ ...data, expiresMs: Date.parse(data.expiresAt) + offset, resendMs: Date.parse(data.resendAt) + offset });
    setCode('');
    setPassword('');
  }

  async function request(path, body = {}, csrfToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`/api/admin/auth/${path}`, {
        method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { ...makeAdminHeaders(), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  useEffect(() => {
    let active = true;
    request('otp/status').then(({ response, data }) => {
      if (active && response.ok && data.otpRequired) updatePending(data);
    }).catch(() => {}).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.ceil(((pending?.expiresMs || 0) - now) / 1000));
  const resendWait = Math.max(0, Math.ceil((Math.max(pending?.resendMs || 0, retryAt) - now) / 1000));
  const loginWait = Math.max(0, Math.ceil((retryAt - now) / 1000));

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedId = id.trim();
    if (!pending && (!trimmedId || !password)) {
      setMessage('관리자 아이디와 비밀번호를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const { response, data } = pending
        ? await request('otp/verify', { code }, pending.csrfToken)
        : await request('login', { id: trimmedId, password });
      if (data.otpRequired) {
        updatePending(data);
        setMessage(response.ok ? '' : data.message);
        return;
      }
      if (data.retryAfterSeconds) setRetryAt(Date.now() + data.retryAfterSeconds * 1000);
      if (['admin_otp_restart', 'admin_otp_locked'].includes(data.reason)) { setPending(null); setCode(''); }
      if (!response.ok || !data?.valid || !data?.admin) {
        throw new Error(data.message || data.msg || '관리자 로그인에 실패했습니다.');
      }
      setAdminSession(data);
      onAuthenticated(data.admin);
    } catch (error) {
      setMessage(error.name === 'AbortError' ? '응답이 지연되고 있습니다. 페이지를 새로고침해 인증 상태를 확인해주세요.' : error.message || '관리자 로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resendCode() {
    setSubmitting(true);
    setMessage('');
    try {
      const { response, data } = await request('otp/resend', {}, pending.csrfToken);
      if (data.otpRequired) updatePending(data);
      if (data.retryAfterSeconds) setRetryAt(Date.now() + data.retryAfterSeconds * 1000);
      if (['admin_otp_restart', 'admin_otp_locked'].includes(data.reason)) { setPending(null); setCode(''); }
      setMessage(data.message || (response.ok ? '새 인증번호를 보냈습니다.' : '재전송에 실패했습니다.'));
    } catch (_) {
      setMessage('전송 상태를 확인할 수 없습니다. 페이지를 새로고침해주세요.');
    } finally { setSubmitting(false); }
  }

  return (
    <main className="wgs-admin-login-page">
      <section className="wgs-admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-login-icon"><FiLock aria-hidden="true" /></div>
        <p className="wgs-admin-login-kicker">우공실 운영 관리</p>
        <h1 id="admin-login-title">{pending ? '이메일 인증' : '관리자 로그인'}</h1>
        <p className="wgs-admin-login-description">{pending
          ? `${pending.maskedEmail}로 보낸 인증번호 6자리를 입력해주세요.`
          : '사이트 비밀번호를 확인한 뒤 등록된 이메일로 한 번 더 인증합니다.'}</p>

        {restoring ? <p role="status">로그인 상태 확인 중...</p> : <form onSubmit={handleSubmit} className="wgs-admin-login-form">
          {pending ? <>
            <label htmlFor="admin-login-otp">인증번호 6자리</label>
            <input id="admin-login-otp" className="wgs-admin-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} value={code} autoFocus required
              aria-describedby="admin-otp-help" onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
            <p id="admin-otp-help" className="wgs-admin-otp-help">{remaining > 0
              ? `남은 시간 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
              : '인증번호가 만료되었습니다. 새 번호를 요청해주세요.'}</p>
            {pending.deliveryStatus !== 'ready' && <p className="wgs-admin-login-message" role="status">{pending.deliveryStatus === 'sending'
              ? '메일 전송을 확인 중입니다. 잠시 후 새로고침해주세요.' : '메일을 보내지 못했습니다. 잠시 후 재전송해주세요.'}</p>}
          </> : <>
          <label>
            관리자 아이디
            <input value={id} onChange={(event) => setId(event.target.value)} autoComplete="username" required />
          </label>

          <label>
            <span id="admin-login-password-label">비밀번호</span>
            <span className="wgs-admin-password-field">
              <input
                id="admin-login-password"
                aria-labelledby="admin-login-password-label"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={showPassword} aria-controls="admin-login-password">
                {showPassword ? '숨김' : '보기'}
              </button>
            </span>
          </label>
          </>}

          {message && <p className="wgs-admin-login-message" role="alert">{message}</p>}

          <button className="wgs-admin-login-submit" type="submit" disabled={submitting || loginWait > 0 || Boolean(pending && (remaining === 0 || pending.deliveryStatus !== 'ready'))}>
            {submitting ? '확인 중...' : loginWait > 0 ? `${loginWait}초 후 다시 시도` : pending ? '인증하고 로그인' : '인증번호 받기'}
          </button>
          {pending && <div className="wgs-admin-otp-actions">
            <button type="button" onClick={resendCode} disabled={submitting || resendWait > 0}>{resendWait > 0 ? `${resendWait}초 후 재전송` : '인증번호 재전송'}</button>
            <button type="button" disabled={submitting} onClick={() => { setPending(null); setCode(''); setMessage(''); }}>비밀번호부터 다시 입력</button>
          </div>}
        </form>}
        <p className="admin-login-note">{pending ? '메일이 보이지 않으면 스팸함을 확인해주세요. 새 번호를 요청하면 이전 번호는 만료됩니다.' : 'skn29 관리자 계정만 로그인할 수 있습니다.'}</p>
        <a className="admin-login-back" href="/"><FiArrowLeft aria-hidden="true" />학습 사이트로 돌아가기</a>
      </section>
    </main>
  );
}
