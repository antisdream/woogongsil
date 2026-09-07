import React from 'react';
import { formatApprovalPayload, formatDateTime, getApprovalStatusLabel } from '../adminUtils.js';
import AdminModalBackdrop from './AdminModalBackdrop.jsx';

export default function AdminApprovalDetailModal({ approvalDetailItem, setApprovalDetailItem }) {
  if (!approvalDetailItem) return null;

  return (
    <AdminModalBackdrop className="admin-detail-backdrop" onClose={() => setApprovalDetailItem(null)} labelledBy="admin-approval-title">
      <div className="admin-detail-dialog">
        <div className="admin-mail-modal-head">
          <div>
            <p>결재 상세</p>
            <h2 id="admin-approval-title">수정 반영 상세 내용</h2>
            <p>요청자: {approvalDetailItem.requesterName || approvalDetailItem.requesterId || '-'} · 요청일: {formatDateTime(approvalDetailItem.requestedAt)}</p>
          </div>
          <button type="button" className="admin-mail-close" onClick={() => setApprovalDetailItem(null)} aria-label="결재 상세 닫기">닫기</button>
        </div>
        <dl className="admin-detail-summary">
          <div><dt>상태</dt><dd>{getApprovalStatusLabel(approvalDetailItem.status)}</dd></div>
          <div><dt>방식</dt><dd>{approvalDetailItem.actionMethod || '-'}</dd></div>
          <div><dt>요청 내용</dt><dd>{approvalDetailItem.actionTitle || approvalDetailItem.actionType || '-'}</dd></div>
          <div><dt>반려 사유</dt><dd>{approvalDetailItem.rejectReason || '-'}</dd></div>
        </dl>
        <section className="admin-detail-data" aria-label="결재 요청 원본 JSON">
          <h3>요청 데이터</h3>
          <pre tabIndex={0}>{formatApprovalPayload(approvalDetailItem.actionPreview || approvalDetailItem.applyResult || approvalDetailItem)}</pre>
        </section>
      </div>
    </AdminModalBackdrop>
  );
}
