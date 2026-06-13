// 관리자 기능 모듈입니다: AdminUsersTab
import React from 'react';
import {
    RECENT_LOG_PAGE_SIZE,
    formatAgo,
    formatDateTime,
    getUserSortMark,
    isOperatorRow,
    isPrimaryAdminRow,
    isTruthyFlag,
    pickFirstDateValue,
} from '../adminUtils.js';

function renderLogType(type) {
    if (type === '\uB85C\uADF8\uC544\uC6C3' || type === 'logout') return <span className="admin-log-type admin-log-type-out">[\uB85C\uADF8\uC544\uC6C3]</span>;
    if (type === '\uD604\uC7AC \uC811\uC18D') return <span className="admin-log-type admin-log-type-in">[\uD604\uC7AC \uC811\uC18D]</span>;
    return <span className="admin-log-type admin-log-type-in">[\uB85C\uADF8\uC778]</span>;
}

export default function AdminUsersTab({
    onlineFetchedAt,
    fetchOnlineUsers,
    loadingOnline,
    onlineError,
    onlineUsers,
    adminId,
    userPanelMode,
    handleSearchSubmit,
    searchKeyword,
    setSearchKeyword,
    handleResetSearch,
    adminError,
    summary,
    users,
    loadingUsers,
    fetchAdminUsers,
    appliedKeyword,
    handleUserPanelToggle,
    displayedUsers,
    userSort,
    handleUserSort,
    openUserEmailModal,
    isUserActionProtectedRow,
    handleOpenUserRanking,
    handleSuspendUser,
    handleDeleteUser,
    handleToggleOperator,
    safeUserPage,
    userTotalPages,
    setUserPage,
    displayedRecentLogs,
    safeRecentLogPage,
    recentLogTotalPages,
    setRecentLogPage,
}) {
    return (
    <>
      {/* 실시간 접속자 현황 탭 콘텐츠 */}
      <section className="admin-panel admin-online-panel">
    <div className="admin-panel-head">
      <div>
        <h2>실시간 접속자 현황</h2>
        <p>현재 서버에 접속 유지 중인 사용자를 확인합니다. 목록은 10초마다 자동 갱신됩니다.</p>
      </div>

      <div className="admin-panel-actions">
        <span className="admin-small-status">
          마지막 갱신: {onlineFetchedAt ? formatDateTime(onlineFetchedAt) : '-'}
        </span>
        <button type="button" className="admin-primary-mini-btn" onClick={fetchOnlineUsers} disabled={loadingOnline}>
          {loadingOnline ? '갱신중...' : '새로고침'}
        </button>
      </div>
    </div>

    {onlineError && <div className="admin-alert admin-alert-error">{onlineError}</div>}

    <div className="admin-online-grid">
      <article className="admin-online-count-card">
        <span>현재 접속</span>
        <strong>{onlineUsers.length}명</strong>
        <p>현재 서버에서 접속 유지 중인 사용자 수를 표시합니다.</p>
      </article>

      <div className="admin-online-list-card">
        {onlineUsers.length === 0 ? (
          <div className="admin-empty-box">현재 서버 메모리에 표시할 접속자가 없습니다.</div>
        ) : (
          <div className="admin-online-list">
            {onlineUsers.map((onlineUser) => (
              <article className="admin-online-user" key={`${onlineUser.id}-${onlineUser.connectedAt || onlineUser.lastSeen}`}>
                <div className="admin-online-avatar">{String(onlineUser.name || onlineUser.id).slice(0, 1).toUpperCase()}</div>
                <div className="admin-online-info">
                  <div className="admin-online-name-row">
                    <strong>{onlineUser.name}</strong>
                    <span>{onlineUser.id}</span>
                    {onlineUser.id === adminId && <em>관리자</em>}
                  </div>
                  <p>최근 활동: {formatAgo(onlineUser.lastSeen)} · 접속 시작: {formatDateTime(onlineUser.connectedAt)}</p>
                </div>
                <span className="admin-online-live-badge">접속중</span>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
      </section>


      {/* 사용자 관리 탭 콘텐츠 */}
      <section className="admin-panel admin-user-panel">
    <div className="admin-panel-head">
      <div>
        <h2>사용자 관리</h2>
        <p>회원 목록, 최근 접속 기록, 현재 세션 상태를 조회합니다.</p>
      </div>

      {userPanelMode === 'members' && (
        <form className="admin-search-form" onSubmit={handleSearchSubmit}>
          <input
            type="text" value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="아이디, 이름, 이메일 검색" aria-label="회원 검색어"
          />
          <button type="submit">검색</button>
          <button type="button" className="admin-secondary-btn" onClick={handleResetSearch}>
            전체보기
          </button>
        </form>
      )}
    </div>

    {adminError && <div className="admin-alert admin-alert-error">{adminError}</div>}

    <div className="admin-summary-grid">
      <article>
        <span>조회 회원</span>
        <strong>{summary.totalUsers || users.length}명</strong>
      </article>
      <article>
        <span>현재 접속</span>
        <strong>{summary.activeUsers || onlineUsers.length}명</strong>
      </article>
      <article>
        <span>로그인 유지</span>
        <strong>{summary.loggedInUsers || 0}명</strong>
      </article>
      <article>
        <span>오늘 로그인 기록</span>
        <strong>{summary.todayLogs || 0}건</strong>
      </article>
    </div>

    <div className="admin-user-layout admin-user-layout-single">
      {userPanelMode === 'members'? (
        <div className="admin-table-card admin-user-wide-card">
          <div className="admin-card-title-row">
            <div>
              <h3>회원 목록</h3>
              <p>회원 정보, 권한 상태, 접속 상태를 확인합니다.</p>
            </div>
            <div className="admin-card-action-row">
              <button type="button" onClick={() => fetchAdminUsers(appliedKeyword)} disabled={loadingUsers}>
                {loadingUsers ? '불러오는 중...' : '새로고침'}
              </button>
              <button type="button" className="admin-toggle-green" onClick={handleUserPanelToggle}>최근 접속 기록</button>
            </div>
          </div>

          <div className="admin-table-scroll admin-user-table-scroll">
            <table className="admin-user-table">
              <thead>
                <tr>
                  <th><button type="button" className="admin-sort-btn" onClick={() => handleUserSort('id')}>계정 {getUserSortMark(userSort, 'id')}</button></th>
                  <th><button type="button" className="admin-sort-btn" onClick={() => handleUserSort('name')}>이름 {getUserSortMark(userSort, 'name')}</button></th>
                  <th><button type="button" className="admin-sort-btn" onClick={() => handleUserSort('email')}>이메일 {getUserSortMark(userSort, 'email')}</button></th>
                  <th>이메일 전송</th>
                  <th>D-Day</th>
                  <th>상태</th>
                  <th>최근 로그인</th>
                  <th>최근 로그아웃</th>
                  <th>활동</th>
                  <th>가입일자</th>
                  <th>성적 조회</th>
                  <th>임시정지</th>
                  <th>계정삭제</th>
                  <th>관리자 권한</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.length === 0 ? (
                  <tr>
                    <td colSpan="14" className="admin-empty-cell">
                      조회된 회원이 없습니다.
                    </td>
                  </tr>
                ) : (
                  displayedUsers.map((item) => (
                    <tr key={item.id} className={item.id === adminId || isPrimaryAdminRow(item) ? 'admin-row-highlight' : ''}>
                      <td>{item.id}</td>
                      <td>{item.name || '-'}</td>
                      <td>{item.email || '-'}</td>
                      <td>
                        {isPrimaryAdminRow(item) ? <span className="admin-protected-label">관리자 보호</span> : (
                          <button type="button" className="admin-action-btn admin-action-btn-contrast" onClick={() => openUserEmailModal(item)} disabled={!item.email}>
                            전송
                          </button>
                        )}
                      </td>
                      <td>{item.dDay || item.dday || '미설정'}</td>
                      <td>
                        <span className={item.activeInMemory ? 'admin-badge admin-badge-live' : 'admin-badge'}>
                          {item.activeInMemory ? '현재 접속중' : item.statusText || '로그인 유지'}
                        </span>
                      </td>
                      <td>{formatDateTime(pickFirstDateValue(item, ['recentLoginAt', 'lastLoginAt', 'last_login_at', 'lastLogin', 'loginAt']))}</td>
                      <td>{formatDateTime(pickFirstDateValue(item, ['recentLogoutAt', 'lastLogoutAt', 'last_logout_at', 'lastLogout', 'logoutAt']))}</td>
                      <td>
                        <div className="admin-chip-row">
                          <span>게시글 {item.postCount || 0}</span>
                          <span>댓글 {item.commentCount || 0}</span>
                          <span>오답 {item.wrongCount || 0}</span>
                        </div>
                      </td>
                      <td>{formatDateTime(pickFirstDateValue(item, ['createdAt', 'created_at', 'registrationDate', 'registrationDateRaw']))}</td>
                      <td>
                        {isPrimaryAdminRow(item) ? <span className="admin-protected-label">-</span> : (
                          <button type="button" className="admin-action-btn admin-action-btn-contrast" onClick={() => handleOpenUserRanking(item)}>
                            확인하기
                          </button>
                        )}
                      </td>
                      <td>
                        {isUserActionProtectedRow(item) ? <span className="admin-protected-label">관리자 보호</span> : (
                          <>
                            <button type="button" className={isTruthyFlag(item.isSuspended || item.is_suspended) ? 'admin-action-btn admin-action-btn-release' : 'admin-action-btn admin-action-btn-stop'} onClick={() => handleSuspendUser(item)}>
                              {isTruthyFlag(item.isSuspended || item.is_suspended) ? '임시정지 해제' : '임시정지 적용'}
                            </button>
                            {item.suspensionReason ? <small className="admin-row-note">{item.suspensionReason}</small> : null}
                          </>
                        )}
                      </td>
                      <td>
                        {isUserActionProtectedRow(item) ? <span className="admin-protected-label">삭제 불가</span> : (
                          <button type="button" className="admin-action-btn admin-action-btn-danger" onClick={() => handleDeleteUser(item)}>
                            삭제
                          </button>
                        )}
                      </td>
                      <td>
                        {isPrimaryAdminRow(item) ? <span className="admin-protected-label">최고 관리자</span> : isUserActionProtectedRow(item) ? <span className="admin-protected-label">관리자 보호</span> : (
                          <button type="button" className="admin-action-btn admin-action-btn-contrast" onClick={() => handleToggleOperator(item)}>
                            {isOperatorRow(item) ? '관리자 비활성화' : '관리자 활성화'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-user-pagination">
            <button type="button" className="admin-user-page-btn" disabled={safeUserPage <= 1} onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}>이전</button>
            <span>{safeUserPage} / {userTotalPages}</span>
            <button type="button" className="admin-user-page-btn" disabled={safeUserPage >= userTotalPages} onClick={() => setUserPage((prev) => Math.min(userTotalPages, prev + 1))}>다음</button>
          </div>
        </div>
      ) : (
        <div className="admin-table-card admin-user-wide-card">
          <div className="admin-card-title-row">
            <div>
              <h3>최근 접속 기록</h3>
              <p>로그인·로그아웃 이력을 최신순으로 확인합니다.</p>
            </div>
            <div className="admin-card-action-row">
              <button type="button" onClick={() => fetchAdminUsers(appliedKeyword)} disabled={loadingUsers}>
                {loadingUsers ? '불러오는 중...' : '새로고침'}
              </button>
              <button type="button" className="admin-toggle-green" onClick={handleUserPanelToggle}>사용자 관리</button>
            </div>
          </div>
          <div className="admin-table-scroll admin-log-table-scroll">
            <table className="admin-user-table admin-recent-log-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>구분</th>
                  <th>계정</th>
                  <th>기록 시간</th>
                </tr>
              </thead>
              <tbody>
                {displayedRecentLogs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="admin-empty-cell">최근 접속 기록이 없습니다.</td>
                  </tr>
                ) : (
                  displayedRecentLogs.map((log, index) => (
                    <tr key={`${log.userId}-${log.type || log.action}-${log.createdAt || log.time}-${index}`}>
                      <td>{(safeRecentLogPage - 1) * RECENT_LOG_PAGE_SIZE + index + 1}</td>
                      <td><span className="admin-badge admin-badge-live">{renderLogType(log.type || log.action)}</span></td>
                      <td>{log.userId}</td>
                      <td>{formatDateTime(log.createdAt || log.time)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-user-pagination">
            <button type="button" className="admin-user-page-btn" disabled={safeRecentLogPage <= 1} onClick={() => setRecentLogPage((prev) => Math.max(1, prev - 1))}>이전</button>
            <span>{safeRecentLogPage} / {recentLogTotalPages}</span>
            <button type="button" className="admin-user-page-btn" disabled={safeRecentLogPage >= recentLogTotalPages} onClick={() => setRecentLogPage((prev) => Math.min(recentLogTotalPages, prev + 1))}>다음</button>
          </div>
        </div>
      )}
    </div>
      </section>
    </>
    );
}
