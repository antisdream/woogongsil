import React from 'react';
import { FiBarChart2, FiBell, FiBookOpen, FiCheckSquare, FiFileText, FiGrid, FiSliders, FiUserCheck, FiUsers } from 'react-icons/fi';
import { ADMIN_TABS } from '../adminUtils.js';

const TAB_ICONS = { dashboard: FiGrid, users: FiUsers, visitors: FiBarChart2, signupRequests: FiUserCheck, approvals: FiCheckSquare, notice: FiBell, questions: FiFileText, display: FiSliders };

export default function AdminPageHeader({ maintenanceForm, adminStats, activeAdminTab, openAdminTab, isPrimaryAdminViewer = false }) {
  const visibleTabs = ADMIN_TABS.filter((tab) => isPrimaryAdminViewer || tab.id !== 'signupRequests');
  const activeTab = visibleTabs.find((tab) => tab.id === activeAdminTab) || visibleTabs[0];

  return (
    <>
      <aside className="admin-sidebar" aria-label="운영 관리 탐색">
        <a className="admin-brand" href="/"><FiBookOpen aria-hidden="true" /><span>우공실<small>운영 관리</small></span></a>
        <p className="admin-sidebar-label">관리 메뉴</p>
        <nav className="admin-sidebar-nav" aria-label="관리자 기능">
          {visibleTabs.map((tab) => {
            const Icon = TAB_ICONS[tab.id];
            return (
              <button key={tab.id} type="button" className={`admin-nav-item ${activeAdminTab === tab.id ? 'is-active' : ''}`} onClick={() => openAdminTab(tab.id)} aria-current={activeAdminTab === tab.id ? 'page' : undefined}>
                <Icon aria-hidden="true" /><span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-foot">
          <span>{isPrimaryAdminViewer ? '최고관리자' : '운영자'} 권한</span>
          <p>현재 권한에서 사용할 수 있는 메뉴가 표시됩니다.</p>
          <a href="/">학습 사이트로 이동</a>
        </div>
      </aside>
      <header className="admin-workspace-head">
        <label className="admin-mobile-navigation">
          <span>관리 메뉴</span>
          <select value={activeTab.id} onChange={(event) => openAdminTab(event.target.value)} aria-label="관리 메뉴 선택">
            {visibleTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </label>
        <div className="admin-heading-row">
          <div>
            <p className="admin-page-eyebrow">우공실 운영 관리</p>
            <h1>{activeTab.label}</h1>
            <p className="admin-page-description">{activeTab.description}</p>
          </div>
          <span className={`admin-operation-status ${maintenanceForm.enabled ? 'is-maintenance' : ''}`}><span aria-hidden="true" />{maintenanceForm.enabled ? '점검 중' : '정상 운영'}</span>
        </div>
      </header>
      {activeAdminTab === 'dashboard' && (
        <section className="admin-stat-grid admin-workspace-stats" aria-label="관리 현황">
          {adminStats.map((item) => (
            <article className="admin-stat-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><p>{item.desc}</p></article>
          ))}
        </section>
      )}
    </>
  );
}
