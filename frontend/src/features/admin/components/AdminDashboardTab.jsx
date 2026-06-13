// 관리자 기능 모듈입니다: AdminDashboardTab
import React from 'react';
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
    mealMapStats,
}) {
    return (
    <section className="admin-panel admin-dashboard-panel">
      <div className="admin-panel-head">
        <div>
          <h2>관리 현황 요약</h2>
          <p>현재 사이트 운영 상태와 주요 관리 영역을 빠르게 확인합니다.</p>
        </div>
      </div>

      <div className="admin-dashboard-grid">
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('users')}>
          <strong>사용자·접속 관리</strong>
          <p>회원 {summary.totalUsers || users.length}명 · 현재 접속 {onlineUsers.length}명</p>
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
          <p>레이아웃, 문구, 색상, 이미지 관리 영역 준비</p>
        </button>
        <button type="button" className="admin-dashboard-card" onClick={() => openAdminTab('mealmap')}>
          <strong>회식맵 관리</strong>
          <p>승인 대기 {mealMapStats.pending || 0}건 · 공개 {mealMapStats.approved || 0}건</p>
        </button>
      </div>
    </section>
    );
}
