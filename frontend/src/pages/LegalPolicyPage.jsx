import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = '';

export default function LegalPolicyPage({ mode = 'privacy' }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const contexts = mode === 'terms' ? ['signup'] : ['signup', 'fortune'];
    Promise.all(contexts.map((context) => axios.get(`${API_BASE}/api/legal/documents`, { params: { context } })))
      .then((responses) => {
        if (!alive) return;
        const all = responses.flatMap((response) => Array.isArray(response.data?.documents) ? response.data.documents : []);
        setDocuments(mode === 'terms'
          ? all.filter((document) => document.documentCode === 'TERMS')
          : all.filter((document) => document.documentCode !== 'TERMS'));
      })
      .catch((requestError) => {
        if (!alive) return;
        setError(requestError.response?.data?.msg || '문서를 불러오지 못했습니다.');
      });
    return () => { alive = false; };
  }, [mode]);

  return (
    <div className="wgs-typography-scope" style={{ maxWidth: '920px', margin: '30px auto', color: 'var(--wgs-title)' }}>
      <h2 className="wgs-page-title">{mode === 'terms' ? '서비스 이용약관' : '개인정보 처리 안내'}</h2>
      {error && <div role="alert" style={{ color: '#fca5a5', padding: '14px' }}>{error}</div>}
      {!error && documents.length === 0 && <p style={{ color: 'var(--wgs-muted)' }}>문서를 불러오는 중입니다...</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {documents.map((document) => (
          <article key={document.documentCode} style={{ padding: '24px', borderRadius: '12px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-card-bg)' }}>
            <h3 style={{ marginTop: 0 }}>{document.title}</h3>
            <p style={{ color: 'var(--wgs-subtle)', fontSize: '13px' }}>시행 {String(document.effectiveAt || '').slice(0, 10)}</p>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75, color: 'var(--wgs-muted)' }}>{document.content}</div>
          </article>
        ))}
      </div>
      <p style={{ color: 'var(--wgs-subtle)', fontSize: '12px', marginTop: '18px' }}>
        이 화면은 DB에 활성 버전으로 등록된 문서 본문과 동일한 내용을 표시합니다.
      </p>
    </div>
  );
}
