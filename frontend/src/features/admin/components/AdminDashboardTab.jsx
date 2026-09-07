// 관리자 기능 모듈입니다: AdminDashboardTab
import React from 'react';
import { FiArrowUpRight } from 'react-icons/fi';
import { normalizeApprovalStatus } from '../adminUtils.js';

export default function AdminDashboardTab({
    openAdminTab,
    summary,
    users,
    onlineUsers,
    adminApprovals,
    noticeHistory,
    maintenanceForm,
    questionMeta,
    visitorSummary,
    visitorError,
    loadingUsers,
    adminError,
}) {
    return (
    <section className="admin-panel admin-dashboard-panel">
      <div className="admin-panel-head">
        <div>
          <h2>운영 업무 바로가기</h2>
          <p>현황을 확인하고 필요한 관리 화면으로 이동하세요.</p>
        </div>
      </div>

      {adminError && <div className="admin-alert admin-alert-error" role="alert">{adminError}</div>}
      <div className="admin-dashboard-grid">
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('users')}>
          <FiArrowUpRight className="admin-dashboard-arrow" aria-hidden="true" />
          <strong>사용자·접속 관리</strong>
          <p>{loadingUsers ? '회원 현황을 불러오는 중입니다.' : adminError ? '회원 현황 확인이 필요합니다.' : `회원 ${summary.totalUsers || users.length}명 · 현재 접속 ${onlineUsers.length}명`}</p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('visitors')}>
          <strong>방문 통계</strong>
          <p>
            {visitorError
              ? '방문 통계를 확인할 수 없습니다.'
              : visitorSummary
                ? `오늘 ${visitorSummary.today || 0}회 · 누적 ${visitorSummary.total || 0}회`
                : '방문 통계를 불러오는 중입니다.'}
          </p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('approvals')}>
          <strong>결재 사항</strong>
          <p>결재 대기 {adminApprovals.filter((approval) => normalizeApprovalStatus(approval.status) === 'PENDING').length}건 · 전체 {adminApprovals.length}건</p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('notice')}>
          <strong>공지·점검 관리</strong>
          <p>최근 공지 {noticeHistory.length}건 · 점검 상태 {maintenanceForm.enabled ? 'ON' : 'OFF'}</p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('questions')}>
          <strong>문제·해설 관리</strong>
          <p>필기 {questionMeta.summary?.written || 0}개 · 실기 {Number(questionMeta.summary?.ipepRandom || 0) + Number(questionMeta.summary?.ipepPast || 0)}개</p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('display')}>
          <strong>화면 설정 관리</strong>
          <p>사이트 문구, 배너와 화면 설정을 관리합니다.</p>
        </button>
      </div>
    </section>
    );
}
