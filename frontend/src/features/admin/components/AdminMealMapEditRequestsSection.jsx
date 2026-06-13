// 관리자 기능 모듈입니다: AdminMealMapEditRequestsSection
import React from 'react';
import { buildMealMapEditDiffRows } from '../adminUtils.js';

export default function AdminMealMapEditRequestsSection({
    fetchMealMapEditRequests,
    mealMapEditLoading,
    mealMapEditStats,
    mealMapEditStatusFilter,
    setMealMapEditStatusFilter,
    mealMapEditKeyword,
    setMealMapEditKeyword,
    mealMapEditError,
    mealMapEditRequests,
    runMealMapEditAction,
}) {
    return (
    <section className="admin-section admin-mealmap-edit-review-section">
      <div className="admin-section-title-row">
        <div>
          <h3>회식맵 수정 제안 관리</h3>
          <p>사용자가 제안한 식당 정보 수정안을 확인하고 승인 또는 반려합니다. 승인하면 등록된 장소 정보에 즉시 반영됩니다.</p>
        </div>
        <button type="button" className="admin-mini-btn" onClick={fetchMealMapEditRequests} disabled={mealMapEditLoading}>
          {mealMapEditLoading ? '확인중...' : '수정 제안 새로고침'}
        </button>
      </div>

      <div className="admin-mealmap-stats-grid admin-mealmap-edit-stats-grid">
        <div className="admin-mealmap-stat-card"><strong>{mealMapEditStats.pending || 0}</strong><span>승인 대기</span></div>
        <div className="admin-mealmap-stat-card"><strong>{mealMapEditStats.approved || 0}</strong><span>승인 완료</span></div>
        <div className="admin-mealmap-stat-card"><strong>{mealMapEditStats.rejected || 0}</strong><span>반려</span></div>
      </div>

      <div className="admin-mealmap-toolbar admin-mealmap-edit-toolbar">
        <select value={mealMapEditStatusFilter} onChange={(event) => setMealMapEditStatusFilter(event.target.value)}>
          <option value="pending">승인 대기</option>
          <option value="approved">승인 완료</option>
          <option value="rejected">반려</option>
          <option value="all">전체</option>
        </select>
        <input
          value={mealMapEditKeyword}
          onChange={(event) => setMealMapEditKeyword(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') fetchMealMapEditRequests(); }}
          placeholder="식당명/제안자/수정 내용 검색"
        />
        <button type="button" onClick={fetchMealMapEditRequests} disabled={mealMapEditLoading}>검색</button>
      </div>

      {mealMapEditError && <p className="admin-error-text">{mealMapEditError}</p>}

      <div className="admin-mealmap-edit-list">
        {mealMapEditLoading ? (
          <div className="admin-mealmap-empty">수정 제안을 불러오는 중...</div>
        ) : mealMapEditRequests.length === 0 ? (
          <div className="admin-mealmap-empty">현재 조건에 맞는 수정 제안이 없습니다.</div>
        ) : (
          mealMapEditRequests.map((request) => {
            const oldData = request.old_data || {};
            const editDiffRows = buildMealMapEditDiffRows(request);

            return (
              <article key={request.id} className="admin-mealmap-edit-card">
                <div className="admin-mealmap-edit-card-head">
                  <div>
                    <strong>{request.place_name || request.current_name || oldData.name || '회식맵 장소'}</strong>
                    <p>제안자: {request.proposer_name || request.proposed_by || '익명'} · 상태: {request.status}</p>
                  </div>
                  <span>{request.created_at ? new Date(request.created_at).toLocaleString('ko-KR') : '-'}</span>
                </div>

                <div className="admin-mealmap-edit-reason">
                  <b>수정 사유</b>
                  <p>{request.reason || '-'}</p>
                </div>

                <div className="admin-mealmap-edit-diff-list">
                  {editDiffRows.length === 0 ? (
                    <div className="admin-mealmap-edit-diff-row">
                      <span>수정 내용</span>
                      <div><em>현재 등록값</em><p>-</p></div>
                      <div><em>제안</em><p>표시할 수정 항목이 없습니다. 새로고침 후 다시 확인해 주세요.</p></div>
                    </div>
                  ) : editDiffRows.map((row) => (
                    <div key={row.label} className="admin-mealmap-edit-diff-row">
                      <span>{row.label}</span>
                      <div><em>현재 등록값</em><p style={{ whiteSpace: 'pre-line' }}>{row.before}</p></div>
                      <div><em>제안</em><p style={{ whiteSpace: 'pre-line' }}>{row.after}</p></div>
                    </div>
                  ))}
                </div>

                {request.status === 'pending' && (
                  <div className="admin-mealmap-edit-actions">
                    <button type="button" className="approve" onClick={() => runMealMapEditAction(request, 'approve')}>승인</button>
                    <button type="button" className="reject" onClick={() => runMealMapEditAction(request, 'reject')}>반려</button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
    );
}
