import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import LegalConsentBlock from '../components/LegalConsentBlock';
import { FiShield } from 'react-icons/fi';
import '../styles/app/community-redesign.css';

const REQUIRED_CODES = ['TERMS', 'SIGNUP_PRIVACY'];

export default function AccountLegalConsent({ onAccepted, onLogout }) {
  const [documents, setDocuments] = useState([]);
  const [decisions, setDecisions] = useState({ TERMS: '', SIGNUP_PRIVACY: '' });
  const [age14Confirmed, setAge14Confirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/legal/documents', { params: { context: 'signup' } });
      const nextDocuments = Array.isArray(response.data?.documents) ? response.data.documents : [];
      const requiredDocuments = REQUIRED_CODES
        .map((code) => nextDocuments.find((document) => document.documentCode === code))
        .filter(Boolean);
      if (requiredDocuments.length !== REQUIRED_CODES.length) {
        throw new Error('현재 적용 중인 필수 동의 문서를 확인할 수 없습니다.');
      }
      setDocuments(requiredDocuments);
    } catch (requestError) {
      setDocuments([]);
      setError(requestError.response?.data?.msg || requestError.message || '동의 문서를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const canSubmit = useMemo(() => (
    !loading
    && !error
    && documents.length === REQUIRED_CODES.length
    && REQUIRED_CODES.every((code) => decisions[code] === 'agree')
    && age14Confirmed
  ), [age14Confirmed, decisions, documents.length, error, loading]);

  const submitAcceptance = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      alert('필수 동의 2개와 만 14세 이상 확인을 모두 완료해주세요.');
      return;
    }

    const id = sessionStorage.getItem('userId') || '';
    setSubmitting(true);
    setError('');
    try {
      const response = await axios.post('/api/legal/user-acceptance', {
        id,
        userId: id,
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
        legal: {
          age14Confirmed: true,
          acceptances: documents.map((document) => ({
            documentCode: document.documentCode,
            version: document.version,
            sha256: document.sha256,
            accepted: true,
          })),
        },
      });
      if (!response.data?.success || response.data?.required) {
        throw new Error('동의 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.');
      }
      sessionStorage.setItem('wgsLegalConsentRequired', 'false');
      onAccepted?.(response.data.status);
    } catch (requestError) {
      setError(requestError.response?.data?.msg || requestError.message || '동의 내용을 저장하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="wgs-account-consent-page community-page community-account-consent">
      <section className="wgs-account-consent-card" aria-labelledby="account-consent-title">
        <p className="wgs-account-consent-kicker ui-eyebrow"><FiShield aria-hidden="true" /> 우공실 계정 안내</p>
        <h1 id="account-consent-title">서비스 이용 동의 확인</h1>
        <p className="wgs-account-consent-description">
          기존 회원도 현재 적용 중인 이용약관과 개인정보 수집·이용 내용을 확인해야 서비스를 계속 이용할 수 있습니다.
          각 내용을 읽고 동의 여부를 선택해주세요.
        </p>

        <div className="community-consent-guide"><strong>확인 순서</strong><span>필수 문서 2개 확인 → 동의 여부 선택 → 연령 확인 → 계속하기</span></div>

        {loading && <div className="wgs-account-consent-state" role="status">동의 문서를 불러오는 중입니다...</div>}
        {error && (
          <div className="wgs-account-consent-state is-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={loadDocuments}>다시 불러오기</button>
          </div>
        )}

        {!loading && documents.map((document) => (
          <LegalConsentBlock
            key={document.documentCode}
            document={document}
            decision={decisions[document.documentCode]}
            onDecisionChange={(decision) => setDecisions((current) => ({
              ...current,
              [document.documentCode]: decision,
            }))}
          />
        ))}

        {!loading && documents.length === REQUIRED_CODES.length && (
          <label className="wgs-age-confirm wgs-account-consent-age">
            <input
              className="wgs-legal-check-input"
              type="checkbox"
              checked={age14Confirmed}
              onChange={(event) => setAge14Confirmed(event.target.checked)}
            />
            <span><strong>[필수]</strong> 본인은 만 14세 이상입니다. 우공실은 만 14세 미만 회원가입을 받지 않습니다.</span>
          </label>
        )}

        <form className="wgs-account-consent-actions" onSubmit={submitAcceptance}>
          <button type="button" className="is-secondary" onClick={() => onLogout?.()} disabled={submitting}>로그아웃</button>
          <button type="submit" className="is-primary" disabled={!canSubmit || submitting}>
            {submitting ? '저장 중...' : '동의하고 계속하기'}
          </button>
        </form>
      </section>
    </main>
  );
}
