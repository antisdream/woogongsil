import React, { useState } from 'react';
import { FiArrowLeft, FiLock } from 'react-icons/fi';
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
        <div className="admin-login-icon"><FiLock aria-hidden="true" /></div>
        <p className="wgs-admin-login-kicker">우공실 운영 관리</p>
        <h1 id="admin-login-title">관리자 로그인</h1>
        <p className="wgs-admin-login-description">운영 계정으로 로그인해 회원, 문제와 사이트 설정을 관리하세요.</p>

        <form onSubmit={handleSubmit} className="wgs-admin-login-form">
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

          {message && <p className="wgs-admin-login-message" role="alert">{message}</p>}

          <button className="wgs-admin-login-submit" type="submit" disabled={submitting}>
            {submitting ? '확인 중...' : '관리자 로그인'}
          </button>
        </form>
        <p className="admin-login-note">일반 회원 계정과 별도로 발급된 관리자 계정이 필요합니다.</p>
        <a className="admin-login-back" href="/"><FiArrowLeft aria-hidden="true" />학습 사이트로 돌아가기</a>
      </section>
    </main>
  );
}
