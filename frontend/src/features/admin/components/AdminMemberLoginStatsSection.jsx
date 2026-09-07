import React from 'react';
import VisitorTrendChart from './VisitorTrendChart.jsx';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');
const PERIOD_DESCRIPTIONS = {
  day: '선택일 첫 로그인 시간대별',
  week: '주간 일별',
  month: '월간 일별',
  year: '연간 월별',
};

function formatCount(value, hasData) {
  if (!hasData) return '—';
  const numericValue = Number(value);
  return NUMBER_FORMATTER.format(Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0);
}

function getRangeText(data) {
  const start = data?.range?.start;
  const end = data?.range?.end;
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  return start || end || '';
}

export default function AdminMemberLoginStatsSection({
  stats,
  period = 'day',
  anchor = '',
}) {
  if (!stats) return null;

  const {
    data = null,
    loading = false,
    error = '',
    reload,
  } = stats;
  const hasData = Boolean(data && data.available !== false);
  const summary = data?.summary || {};
  const series = Array.isArray(data?.series) ? data.series : [];
  const displayedPeriod = data?.period || period;
  const rangeText = getRangeText(data);
  const isStaleResult = Boolean(
    data && (data.period !== period || data.anchor !== anchor),
  );
  const isZeroSeries = series.length > 0
    && series.every((point) => Number(point?.count || 0) === 0);
  const chartUnit = displayedPeriod === 'year' ? '명·일' : '명';
  const summaryItems = [
    { key: 'today', label: '오늘', value: summary.today, unit: '명', description: '오늘 로그인한 고유 회원' },
    { key: 'week', label: '이번 주', value: summary.thisWeek, unit: '명·일', description: '일별 고유 회원 누적' },
    { key: 'month', label: '이번 달', value: summary.thisMonth, unit: '명·일', description: '일별 고유 회원 누적' },
    { key: 'year', label: '올해', value: summary.thisYear, unit: '명·일', description: '일별 고유 회원 누적' },
    { key: 'total', label: '전체', value: summary.total, unit: '명·일', description: '최초 기록 후 누적' },
  ];

  return (
    <section className="admin-member-login-section" aria-busy={loading}>
      <div className="admin-visitor-chart-head admin-member-login-head">
        <div>
          <div className="admin-member-login-title-row">
            <h3>회원 로그인 활동</h3>
            <span>공개 방문자와 별도</span>
          </div>
          <p>
            로그인 성공 기록을 날짜·회원별 1회로 중복 제거한 참고 지표입니다.
            비회원 방문은 포함하지 않으며, 관리자·운영자는 역할 정보가 확인되는 경우 제외합니다.
          </p>
        </div>
        <button
          type="button"
          className="admin-primary-mini-btn"
          onClick={() => reload?.()}
          disabled={loading}
        >
          {loading ? '불러오는 중...' : '회원 통계 새로고침'}
        </button>
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
          회원 로그인 통계를 불러오는 중입니다.
        </div>
      )}

      {!error && !loading && data?.available === false && (
        <div className="admin-visitor-state admin-member-login-unavailable" role="status">
          현재 데이터베이스에서 회원 로그인 이력 구조를 확인할 수 없습니다.
          공개 방문 통계는 이 상태와 관계없이 계속 사용할 수 있습니다.
        </div>
      )}

      {!error && !loading && !data && (
        <div className="admin-visitor-state" role="status">
          아직 조회된 회원 로그인 통계가 없습니다.
        </div>
      )}

      {hasData && (
        <>
          <div className="admin-visitor-summary-grid admin-member-login-summary-grid" aria-label="회원 로그인 활동 요약">
            {summaryItems.map((item) => (
              <article key={item.key}>
                <span>{item.label}</span>
                <strong>
                  {formatCount(item.value, true)}
                  <small>{item.unit}</small>
                </strong>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <div className="admin-visitor-chart-card admin-member-login-chart-card">
            <div className="admin-visitor-chart-head">
              <div>
                <h3>{PERIOD_DESCRIPTIONS[displayedPeriod] || PERIOD_DESCRIPTIONS.day} 로그인 회원</h3>
                <p>
                  {rangeText || anchor}
                  {data.timezone && <span> · {data.timezone}</span>}
                </p>
              </div>
              {(loading || isStaleResult) && (
                <span className="admin-visitor-updating" role="status">
                  {loading ? '업데이트 중...' : '이전 조회 결과'}
                </span>
              )}
            </div>

            {isZeroSeries && (
              <div className="admin-visitor-zero-note" role="status">
                선택한 기간에 날짜가 확인되는 회원 로그인 기록이 없습니다.
              </div>
            )}

            <VisitorTrendChart
              points={series}
              title="회원 로그인 활동 추이"
              metricLabel="로그인 회원"
              unit={chartUnit}
              emptyMessage="선택한 기간에 표시할 회원 로그인 기록이 없습니다."
              zeroMessage="선택 기간의 회원 로그인 활동이 0입니다."
            />

            <div className="admin-visitor-meta">
              <span>집계 기준: 회원별 하루 첫 로그인 1회</span>
              {data.metadata?.adminExcluded && <span>관리자·운영자 제외</span>}
              {summary.uniqueMembers > 0 && <span>기록 회원: {NUMBER_FORMATTER.format(summary.uniqueMembers)}명</span>}
              {summary.rangeUniqueMembers > 0 && <span>선택 기간 고유 회원: {NUMBER_FORMATTER.format(summary.rangeUniqueMembers)}명</span>}
              {summary.startedAt && <span>최초 기록일: {String(summary.startedAt).slice(0, 10)}</span>}
            </div>
          </div>

          <p className="admin-member-login-disclaimer">
            이 수치는 로그인 없이 둘러본 방문과 로그인 상태가 유지된 재방문을 포함하지 않으며,
            공개 화면의 오늘·총 방문자 수에는 합산하지 않습니다.
          </p>
        </>
      )}
    </section>
  );
}
