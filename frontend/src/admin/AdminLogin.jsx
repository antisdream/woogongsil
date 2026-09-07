import React, { useState } from 'react';
import { makeAdminHeaders, setAdminSession } from './adminSession.js';

export default function AdminLogin({ onAuthenticated, initialMessage = '' }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedId = id.trim();
    if (!trimmedId || !password) {
      setMessage('관리자 아이디와 비밀번호를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ id: trimmedId, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.valid || !data?.admin) {
        throw new Error(data.message || data.msg || '관리자 로그인에 실패했습니다.');
      }
      setAdminSession(data);
      onAuthenticated(data.admin);
    } catch (error) {
      setMessage(error.message || '관리자 로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="wgs-admin-login-page">
      <section className="wgs-admin-login-card" aria-labelledby="admin-login-title">
        <p className="wgs-admin-login-kicker">WOOGONGSIL OPERATIONS</p>
        <h1 id="admin-login-title">관리자 전용 로그인</h1>
        <p className="wgs-admin-login-description">일반 회원 로그인과 분리된 운영 관리 세션입니다.</p>

        <form onSubmit={handleSubmit} className="wgs-admin-login-form">
          <label>
            관리자 아이디
            <input value={id} onChange={(event) => setId(event.target.value)} autoComplete="username" required />
          </label>

          <label>
            비밀번호
            <span className="wgs-admin-password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? '숨김' : '보기'}
              </button>
            </span>
          </label>

          {message && <p className="wgs-admin-login-message" role="alert">{message}</p>}

          <button className="wgs-admin-login-submit" type="submit" disabled={submitting}>
            {submitting ? '확인 중...' : '관리자 로그인'}
          </button>
        </form>
      </section>
    </main>
  );
}
