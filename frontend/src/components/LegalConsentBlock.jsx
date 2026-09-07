import React from 'react';

export default function LegalConsentBlock({ document, decision = '', onDecisionChange, compact = false }) {
  if (!document) return null;

  return (
    <section
      className={`wgs-legal-consent-block${compact ? ' is-compact' : ''}`}
      aria-labelledby={`legal-title-${document.documentCode}`}
      style={{
        border: '1px solid var(--wgs-border)',
        borderRadius: '12px',
        padding: compact ? '14px' : '18px',
        background: 'var(--wgs-practice-toggle-bg)',
      }}
    >
      <div className="wgs-legal-consent-block__header">
        <h3 id={`legal-title-${document.documentCode}`} style={{ margin: 0, color: 'var(--wgs-title)', fontSize: compact ? '16px' : '18px' }}>
          {document.title}
        </h3>
      </div>

      <div
        tabIndex="0"
        aria-label={`${document.title} 본문`}
        style={{
          marginTop: '12px',
          maxHeight: compact ? '170px' : '230px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.65,
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid var(--wgs-border)',
          background: 'var(--wgs-input-bg)',
          color: 'var(--wgs-muted)',
          fontSize: '13px',
        }}
      >
        {document.content}
      </div>

      <fieldset className="wgs-legal-choice-group">
        <legend style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {document.title} 동의 여부
        </legend>
        <label className="wgs-legal-choice" style={{ color: 'var(--wgs-title)' }}>
          <input
            className="wgs-legal-choice-input"
            type="radio"
            name={`legal-${document.documentCode}`}
            value="agree"
            checked={decision === 'agree'}
            onChange={() => onDecisionChange?.('agree')}
          />
          <span>동의함</span>
        </label>
        <label className="wgs-legal-choice" style={{ color: 'var(--wgs-muted)' }}>
          <input
            className="wgs-legal-choice-input"
            type="radio"
            name={`legal-${document.documentCode}`}
            value="disagree"
            checked={decision === 'disagree'}
            onChange={() => onDecisionChange?.('disagree')}
          />
          <span>동의하지 않음</span>
        </label>
      </fieldset>
    </section>
  );
}
