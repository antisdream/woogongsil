// 관리자 기능 모듈입니다: AdminApprovalDetailModal
import React from 'react';
import {
    formatApprovalPayload,
    formatDateTime,
    getApprovalStatusLabel,
} from '../adminUtils.js';

export default function AdminApprovalDetailModal({
    approvalDetailItem,
    setApprovalDetailItem,
}) {
    if (!approvalDetailItem) return null;

    return (
    <div
      className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-label="결재 상세 내용" style={{
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px',
    overflow: 'auto',
    background: 'rgba(2, 6, 23, 0.82)',
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  }}>
      <div
        className="admin-approval-detail-modal" style={{
    position: 'relative',
    zIndex: 10001,
    width: 'min(1180px, calc(100vw - 56px))',
    maxHeight: '88vh',
    overflow: 'auto',
    padding: '34px',
    borderRadius: '28px',
    background: 'var(--wgs-fix15-27-modal-bg, #07111f)',
    backgroundColor: 'var(--wgs-fix15-27-modal-bg, #07111f)',
    color: 'var(--wgs-fix15-27-modal-text, #f8fafc)',
    border: '1px solid var(--wgs-fix15-27-modal-border, rgba(148, 163, 184, 0.45))',
    boxShadow: '0 34px 100px rgba(0, 0, 0, 0.72)',
    opacity: 1,
    isolation: 'isolate',
    backgroundClip: 'padding-box',
  }}>
        <div className="admin-approval-detail-modal-head">
          <div>
            <span className="admin-small-badge">결재 상세</span>
            <h3>수정 반영 상세 내용</h3>
            <p>
              요청자: {approvalDetailItem.requesterName || approvalDetailItem.requesterId || '-'} ·
              결재 올린 날짜: {formatDateTime(approvalDetailItem.requestedAt)}
            </p>
          </div>
          <button
            type="button" className="admin-modal-close-btn" onClick={() => setApprovalDetailItem(null)}
            aria-label="결재 상세 닫기"
          >
            닫기
          </button>
        </div>

        <div className="admin-approval-detail-summary">
          <div><strong>상태</strong><span>{getApprovalStatusLabel(approvalDetailItem.status)}</span></div>
          <div><strong>방식</strong><span>{approvalDetailItem.actionMethod || '-'}</span></div>
          <div><strong>요청 내용</strong><span>{approvalDetailItem.actionTitle || approvalDetailItem.actionType || '-'}</span></div>
          <div><strong>반려 사유</strong><span>{approvalDetailItem.rejectReason || '-'}</span></div>
        </div>

        {/*  결재 상세 JSON 영역: 뒤 배경 비침 방지용 독립 패널 */}
        <section
          className="admin-approval-detail-json-box admin-approval-detail-json-panel" aria-label="결재 요청 원본 JSON" style={{
            display: 'block',
            width: '100%',
            marginTop: '24px',
            padding: '20px',
            borderRadius: '22px',
            background: '#020617',
            backgroundColor: '#020617',
            backgroundImage: 'linear-gradient(#020617, #020617)',
            border: '1px solid rgba(148, 163, 184, 0.55)',
            boxShadow: '0 24px 70px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255,255,255,0.04)',
            opacity: 1,
            isolation: 'isolate',
            position: 'relative',
            zIndex: 20,
            overflow: 'hidden',
            filter: 'none',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            mixBlendMode: 'normal',
            transform: 'translateZ(0)',
            contain: 'paint',
          }}
        >
          <pre
            className="admin-approval-detail-pre" style={{
              display: 'block',
              position: 'relative',
              zIndex: 2,
              margin: 0,
              padding: '20px',
              borderRadius: '18px',
              maxHeight: '420px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.65,
              background: '#020617',
              backgroundColor: '#020617',
              backgroundImage: 'linear-gradient(#020617, #020617)',
              color: '#ff3b3b',
              border: '1px solid rgba(148, 163, 184, 0.45)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '14px',
              opacity: 1,
              filter: 'none',
              backdropFilter: 'none',
              WebkitBackdropFilter: 'none',
              mixBlendMode: 'normal',
            }}
          >
            {formatApprovalPayload(approvalDetailItem.actionPreview || approvalDetailItem.applyResult || approvalDetailItem)}
          </pre>
        </section>
      </div>
    </div>
    );
}
