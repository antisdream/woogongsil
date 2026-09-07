import React from 'react';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');

function formatSessionDateTime(value) {
  if (!value) return '—';
  const text = String(value).trim();
  const databaseDateMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (databaseDateMatch) return `${databaseDateMatch[1]} ${databaseDateMatch[2]}`;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Number(value) || 0);
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}초`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${NUMBER_FORMATTER.format(totalMinutes)}분`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function formatEntryPath(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

export default function AdminVisitorSessionList({
  data = null,
  loading = false,
  error = '',
  page = 1,
  setPage,
  reload,
}) {
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const pagination = data?.pagination || {};
  const currentPage = Number(pagination.page) || page || 1;
  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
  const total = Math.max(0, Number(pagination.total) || 0);

  return (
    <section className="admin-visitor-session-card" aria-busy={loading}>
      <div className="admin-visitor-session-head">
        <div>
          <h3>방문 세션 목록</h3>
          <p>위 기간과 방문 유형·회원 필터가 동일하게 적용됩니다.</p>
        </div>
        <strong>총 {NUMBER_FORMATTER.format(total)}건</strong>
      </div>

      {error && (
        <div className="admin-alert admin-alert-error admin-visitor-state" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => reload?.()} disabled={loading}>다시 시도</button>
        </div>
      )}

      {!error && loading && !data && (
        <div className="admin-visitor-state admin-visitor-loading" role="status">
          <span className="admin-visitor-spinner" aria-hidden="true" />
          방문 세션 목록을 불러오는 중입니다.
        </div>
      )}

      {!error && !loading && data && sessions.length === 0 && (
        <div className="admin-visitor-state admin-visitor-empty" role="status">
          선택한 조건에 해당하는 방문 세션이 없습니다.
        </div>
      )}

      {!error && sessions.length > 0 && (
        <div className="admin-visitor-session-table-wrap">
          <table className="admin-visitor-session-table">
            <caption className="admin-visitor-sr-only">선택 기간 방문 세션 상세 목록</caption>
            <thead>
              <tr>
                <th scope="col">방문 유형</th>
                <th scope="col">회원</th>
                <th scope="col">접속 시작</th>
                <th scope="col">마지막 활동</th>
                <th scope="col">상태</th>
                <th scope="col">체류시간</th>
                <th scope="col">최초 진입 화면</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.key}>
                  <td>
                    <span className={`admin-visitor-type-badge is-${session.visitorType}`}>
                      {session.visitorType === 'member' ? '회원' : '비회원'}
                    </span>
                    {session.historical && (
                      <span className="admin-visitor-historical-badge">기존 로그인 기록</span>
                    )}
                  </td>
                  <td>
                    {session.member
                      ? <><strong>{session.member.name}</strong><small>{session.member.id}</small></>
                      : '—'}
                  </td>
                  <td>{formatSessionDateTime(session.startedAt)}</td>
                  <td>{formatSessionDateTime(session.lastSeenAt)}</td>
                  <td>
                    <span className={`admin-visitor-status is-${session.status}`}>
                      {session.status === 'active' ? '활동 중' : '종료 추정'}
                    </span>
                  </td>
                  <td>{formatDuration(session.durationSeconds)}</td>
                  <td title={session.entryPath || ''}>{formatEntryPath(session.entryPath)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="admin-visitor-pagination" aria-label="방문 세션 페이지">
          <button
            type="button"
            onClick={() => setPage?.(currentPage - 1)}
            disabled={loading || currentPage <= 1}
          >
            이전
          </button>
          <span>{currentPage} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage?.(currentPage + 1)}
            disabled={loading || currentPage >= totalPages}
          >
            다음
          </button>
        </nav>
      )}

      <p className="admin-visitor-privacy-note">
        개인정보 보호를 위해 IP, 브라우저 식별값, 인증·세션 토큰은 표시하지 않습니다.
      </p>
    </section>
  );
}
