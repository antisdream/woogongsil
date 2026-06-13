// 관리자 기능 모듈입니다: AdminApprovalsTab
import React from 'react';
import {
    APPROVAL_PAGE_SIZE,
    formatDateTime,
    getApprovalStatusLabel,
} from '../adminUtils.js';

export default function AdminApprovalsTab({
    approvalMeta,
    sortedApprovals,
    safeApprovalPage,
    approvalTotalPages,
    selectedApprovalIds,
    handleDeleteSelectedApprovals,
    loadingApprovals,
    selectableApprovalIdsOnPage,
    isAllApprovalsOnPageSelected,
    toggleAllApprovalSelection,
    fetchAdminApprovals,
    approvalError,
    pagedApprovals,
    isApprovalDeletable,
    toggleApprovalSelection,
    renderApprovalSortMark,
    cycleApprovalStatusSort,
    cycleApprovalDirectionalSort,
    setApprovalDetailItem,
    handleApproveRequest,
    handleRejectRequest,
    setApprovalPage,
}) {
    return (
    <section className="admin-panel admin-approval-panel">
      <div className="admin-panel-head admin-approval-head">
        <div>
          <h2>결재 사항</h2>
          <p>{approvalMeta.isPrimaryAdmin ? '운영자 권한 사용자가 요청한 추가·수정·삭제 작업을 승인 또는 반려합니다.' : '내가 올린 추가·수정·삭제 요청의 승인/반려 결과를 확인합니다.'}</p>
        </div>
        <div className="admin-approval-toolbar">
          <span className="admin-approval-count">
            총 {sortedApprovals.length}개 · {safeApprovalPage}/{approvalTotalPages}페이지
          </span>
          {selectedApprovalIds.length >0 && (
            <button type="button" className="admin-approval-delete-btn" onClick={handleDeleteSelectedApprovals} disabled={loadingApprovals}>
              선택 삭제
            </button>
          )}
          <button
            type="button" className="admin-approval-select-all-btn" onClick={toggleAllApprovalSelection}
            disabled={loadingApprovals || selectableApprovalIdsOnPage.length === 0}
          >
            {isAllApprovalsOnPageSelected ? '전체선택해제' : '전체선택'}
          </button>
          <button type="button" className="admin-primary-mini-btn" onClick={fetchAdminApprovals} disabled={loadingApprovals}>
            {loadingApprovals ? '조회중...' : '새로고침'}
          </button>
        </div>
      </div>
      {approvalError && <div className="admin-alert admin-alert-error">{approvalError}</div>}
      <div className="admin-table-scroll admin-approval-scroll">
        <table className="admin-user-table admin-approval-table">
          <colgroup>
            <col className="approval-col-check" />
            <col className="approval-col-no" />
            <col className="approval-col-status" />
            <col className="approval-col-requester" />
            <col className="approval-col-summary" />
            <col className="approval-col-method" />
            <col className="approval-col-date" />
            <col className="approval-col-date" />
            <col className="approval-col-reason" />
            <col className="approval-col-detail" />
            {approvalMeta.isPrimaryAdmin && <col className="approval-col-process" />}
          </colgroup>
          <thead>
            <tr>
              <th className="admin-approval-check-col">선택</th>
              <th className="admin-approval-no-col">No.</th>
              <th className="approval-status-cell">
                <button type="button" className="admin-sort-header-btn" onClick={cycleApprovalStatusSort}>
                  상태 <span>{renderApprovalSortMark('status')}</span>
                </button>
              </th>
              <th className="approval-requester-cell">
                <button type="button" className="admin-sort-header-btn" onClick={() => cycleApprovalDirectionalSort('requester')}>
                  요청자 <span>{renderApprovalSortMark('requester')}</span>
                </button>
              </th>
              <th className="approval-summary-cell">요청 내용</th>
              <th className="approval-method-cell">방식</th>
              <th className="approval-date-cell">
                <button type="button" className="admin-sort-header-btn" onClick={() => cycleApprovalDirectionalSort('requestedAt')}>
                  결재 올린 날짜 <span>{renderApprovalSortMark('requestedAt')}</span>
                </button>
              </th>
              <th className="approval-date-cell">
                <button type="button" className="admin-sort-header-btn" onClick={() => cycleApprovalDirectionalSort('reviewedAt')}>
                  승인/반려 날짜 <span>{renderApprovalSortMark('reviewedAt')}</span>
                </button>
              </th>
              <th className="approval-reason-cell">반려 사유</th>
              <th className="approval-detail-cell">상세</th>
              {approvalMeta.isPrimaryAdmin && <th className="approval-process-cell">처리</th>}
            </tr>
          </thead>
          <tbody>
            {pagedApprovals.length === 0 ? (
              <tr>
                <td colSpan={approvalMeta.isPrimaryAdmin ? 11 : 10} className="admin-empty-cell">
                  결재 내역이 없습니다.
                </td>
              </tr>
            ) : (
              pagedApprovals.map((approval, index) => {
                const approvalId = Number(approval.id);
                const selected = selectedApprovalIds.includes(approvalId);
                const deletable = isApprovalDeletable(approval);
                return (
                  <tr key={approval.id} className={selected ? 'admin-approval-row-selected' : ''}>
                    <td className="admin-approval-check-col">
                      <input
                        type="checkbox" checked={selected}
                        disabled={!deletable}
                        title={deletable ? '정리할 결재 내역 선택' : '대기 상태는 승인/반려 후 정리 가능'}
                        onChange={() => toggleApprovalSelection(approval)}
                      />
                    </td>
                    <td className="admin-approval-no-col">{(safeApprovalPage - 1) * APPROVAL_PAGE_SIZE + index + 1}</td>
                    <td className="approval-status-cell">
                      <span className={`admin-approval-status admin-approval-status-${String(approval.status || '').toLowerCase()}`}>
                        {getApprovalStatusLabel(approval.status)}
                      </span>
                    </td>
                    <td className="approval-requester-cell">{approval.requesterName || approval.requesterId || '-'}</td>
                    <td className="approval-summary-cell">{approval.actionTitle || '-'}</td>
                    <td className="approval-method-cell">{approval.actionMethod || '-'}</td>
                    <td className="approval-date-cell">{formatDateTime(approval.requestedAt)}</td>
                    <td className="approval-date-cell">{formatDateTime(approval.reviewedAt)}</td>
                    <td className="approval-reason-cell">{approval.rejectReason || '-'}</td>
                    <td className="approval-detail-cell">
                      <button
                        type="button" className="approval-detail-open-btn" onClick={() => setApprovalDetailItem(approval)}
                        title="결재 상세 내용을 크게 확인합니다."
                      >
                        보기
                      </button>
                    </td>
                    {approvalMeta.isPrimaryAdmin && (
                      <td className="approval-process-cell">
                        {approval.status === 'PENDING'? (
                          <div className="admin-approval-actions">
                            <button type="button" className="admin-action-btn admin-action-btn-operator-on" onClick={() => handleApproveRequest(approval.id)}>
                              승인
                            </button>
                            <button type="button" className="admin-action-btn admin-action-btn-danger" onClick={() => handleRejectRequest(approval.id)}>
                              반려
                            </button>
                          </div>
                        ) : (
                          <span className="admin-muted-text">처리완료</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-approval-pagination">
        <button type="button" onClick={() => setApprovalPage((page) => Math.max(1, page - 1))} disabled={safeApprovalPage <= 1}>
          이전
        </button>
        <span>{safeApprovalPage} / {approvalTotalPages}</span>
        <button type="button" onClick={() => setApprovalPage((page) => Math.min(approvalTotalPages, page + 1))} disabled={safeApprovalPage >= approvalTotalPages}>
          다음
        </button>
      </div>
    </section>
    );
}
