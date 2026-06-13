// 관리자 기능 모듈입니다: AdminPageHeader
import React from 'react';
import { ADMIN_TABS } from '../adminUtils.js';

export default function AdminPageHeader({
    maintenanceForm,
    adminStats,
    activeAdminTab,
    openAdminTab,
}) {
    return (
        <>
  <section className="admin-hero-card admin-hero-card-compact">
    <div className="admin-hero-text">
      <p className="admin-kicker">관리자 페이지</p>
      <h1>운영 관리 대시보드</h1>
      <p>
        사용자, 접속 현황, 공지, 점검 상태, 문제/해설 데이터를 기능별 탭에서 관리합니다.
      </p>
    </div>

    <div className="admin-permission-card admin-operation-card">
      <span>운영 상태</span>
      <strong>{maintenanceForm.enabled ? '점검 중' : '정상 운영'}</strong>
    </div>
  </section>

  {/* 관리자 상태 요약 카드 */}
  <section className="admin-stat-grid" aria-label="관리자 상태 요약">
    {adminStats.map((item) => (
      <article className="admin-stat-card" key={item.label}>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
        <p>{item.desc}</p>
      </article>
    ))}
  </section>

  {/* 관리자 기능 탭 메뉴 */}
  <nav className="admin-tab-nav" aria-label="관리자 기능 탭">
    {ADMIN_TABS.map((tab) => (
      <button
        key={tab.id}
        type="button" className={`admin-tab-button ${activeAdminTab === tab.id ? 'admin-tab-button-active' : ''}`}
        onClick={() => openAdminTab(tab.id)}
        aria-pressed={activeAdminTab === tab.id}
      >
        <span className="admin-tab-text">
          <strong>{tab.label}</strong>
          <small>{tab.description}</small>
        </span>
      </button>
    ))}
  </nav>
        </>
    );
}
