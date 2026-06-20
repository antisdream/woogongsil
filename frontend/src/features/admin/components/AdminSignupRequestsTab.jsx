import React from 'react';
import { formatDateTime } from '../adminUtils.js';

const SIGNUP_REQUEST_STATUS_OPTIONS = [
  { value: 'PENDING', label: '승인 대기' },
  { value: 'APPROVED', label: '승인 완료' },
  { value: 'REJECTED', label: '거절 완료' },
  { value: 'ALL', label: '전체' },
];

function getSignupStatusLabel(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'APPROVED') return '승인 완료';
  if (normalized === 'REJECTED') return '거절 완료';
  return '승인 대기';
}

export default function AdminSignupRequestsTab({
  signupRequests,
  signupRequestStats,
  signupRequestStatusFilter,
  setSignupRequestStatusFilter,
  signupRequestKeyword,
  setSignupRequestKeyword,
  signupRequestLoading,
  signupRequestError,
  signupRequestSuccess,
  fetchSignupRequests,
  handleSignupRequestSearch,
  approveSignupRequest,
  rejectSignupRequest,
}) {
  const handleStatusChange = (event) => {
    const nextStatus = event.target.value;
    setSignupRequestStatusFilter(nextStatus);
    fetchSignupRequests({ status: nextStatus });
  };

  return (
    <section className="admin-panel admin-signup-request-panel">
      <div className="admin-panel-head">
        <div>
          <h2>회원가입 승인</h2>
          <p>신규 회원가입 요청을 확인하고 승인 또는 거절합니다. 승인된 사용자에게는 가입 확인 메일이 발송됩니다.</p>
        </div>
        <div className="admin-panel-actions">
          <button type="button" className="admin-primary-mini-btn" onClick={() => fetchSignupRequests()} disabled={signupRequestLoading}>
            {signupRequestLoading ? '조회 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {signupRequestError && <div className="admin-alert admin-alert-error">{signupRequestError}</div>}
      {signupRequestSuccess && <div className="admin-alert admin-alert-success">{signupRequestSuccess}</div>}

      <div className="admin-summary-grid admin-signup-request-summary">
        <article>
          <span>승인 대기</span>
          <strong>{signupRequestStats.pending || 0}건</strong>
        </article>
        <article>
          <span>승인 완료</span>
          <strong>{signupRequestStats.approved || 0}건</strong>
        </article>
        <article>
          <span>거절 완료</span>
          <strong>{signupRequestStats.rejected || 0}건</strong>
        </article>
      </div>

      <div className="admin-card-title-row admin-signup-request-toolbar">
        <div>
          <h3>가입 요청 목록</h3>
          <p>아이디, 이름, 이메일과 신청일을 확인한 뒤 처리해주세요.</p>
        </div>
        <form className="admin-search-form" onSubmit={handleSignupRequestSearch}>
          <select value={signupRequestStatusFilter} onChange={handleStatusChange} aria-label="회원가입 요청 상태">
            {SIGNUP_REQUEST_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={signupRequestKeyword}
            onChange={(event) => setSignupRequestKeyword(event.target.value)}
            placeholder="아이디, 이름, 이메일 검색"
            aria-label="회원가입 요청 검색어"
          />
          <button type="submit" disabled={signupRequestLoading}>검색</button>
        </form>
      </div>

      <div className="admin-table-scroll admin-signup-request-scroll">
        <table className="admin-user-table admin-signup-request-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>상태</th>
              <th>아이디</th>
              <th>이름</th>
              <th>이메일</th>
              <th>신청일</th>
              <th>처리일</th>
              <th>처리자</th>
              <th>거절 사유</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {signupRequests.length === 0 ? (
              <tr>
                <td colSpan="10" className="admin-empty-cell">조회된 회원가입 요청이 없습니다.</td>
              </tr>
            ) : (
              signupRequests.map((request, index) => {
                const status = String(request.status || '').toUpperCase();
                const isPending = status === 'PENDING';
                return (
                  <tr key={request.id}>
                    <td>{index + 1}</td>
                    <td>
                      <span className={`admin-approval-status admin-approval-status-${status.toLowerCase()}`}>
                        {getSignupStatusLabel(status)}
                      </span>
                    </td>
                    <td>{request.loginId || '-'}</td>
                    <td>{request.name || '-'}</td>
                    <td>{request.email || '-'}</td>
                    <td>{formatDateTime(request.requestedAt)}</td>
                    <td>{formatDateTime(request.reviewedAt)}</td>
                    <td>{request.reviewedBy || '-'}</td>
                    <td className="admin-signup-request-note">{request.reviewNote || '-'}</td>
                    <td>
                      {isPending ? (
                        <div className="admin-approval-actions">
                          <button type="button" className="admin-action-btn admin-action-btn-operator-on" onClick={() => approveSignupRequest(request)}>
                            승인
                          </button>
                          <button type="button" className="admin-action-btn admin-action-btn-danger" onClick={() => rejectSignupRequest(request)}>
                            거절
                          </button>
                        </div>
                      ) : (
                        <span className="admin-muted-text">처리 완료</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
