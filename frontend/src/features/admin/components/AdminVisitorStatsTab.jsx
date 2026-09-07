import React from 'react';
import AdminVisitorSessionStatsTab from './AdminVisitorSessionStatsTab.jsx';
import VisitorTrendChart from './VisitorTrendChart.jsx';
import AdminMemberLoginStatsSection from './AdminMemberLoginStatsSection.jsx';
import '../../../styles/admin/admin-visitor-stats.css';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');
const PERIOD_OPTIONS = [
  { value: 'day', label: '일간', description: '선택일 시간대별' },
  { value: 'week', label: '주간', description: '주간 일별' },
  { value: 'month', label: '월간', description: '월간 일별' },
  { value: 'year', label: '연간', description: '연간 월별' },
];

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

export function LegacyAdminVisitorStatsTab({
  data = null,
  period = 'day',
  setPeriod,
  anchor = '',
  setAnchor,
  loading = false,
  error = '',
  reload,
  memberLoginStats = null,
}) {
  const summary = data?.summary || {};
  const series = Array.isArray(data?.series) ? data.series : [];
  const hasData = Boolean(data);
  const displayedPeriod = data?.period || period;
  const isStaleResult = Boolean(
    data && (data.period !== period || data.anchor !== anchor),
  );
  const isZeroSeries = series.length > 0
    && series.every((point) => Number(point?.count || 0) === 0);
  const selectedPeriod = PERIOD_OPTIONS.find((option) => option.value === displayedPeriod)
    || PERIOD_OPTIONS[0];
  const rangeText = getRangeText(data);
  const anyLoading = loading || Boolean(memberLoginStats?.loading);
  const reloadAll = () => {
    reload?.();
    memberLoginStats?.reload?.();
  };
  const summaryItems = [
    { key: 'today', label: '오늘', value: summary.today, description: '오늘 순방문자' },
    { key: 'thisWeek', label: '이번 주', value: summary.thisWeek ?? summary.week, description: '이번 주 누적' },
    { key: 'thisMonth', label: '이번 달', value: summary.thisMonth ?? summary.month, description: '이번 달 누적' },
    { key: 'thisYear', label: '올해', value: summary.thisYear ?? summary.year, description: '올해 누적' },
    { key: 'total', label: '전체', value: summary.total, description: '집계 시작 후 누적' },
  ];

  return (
    <section className="admin-panel admin-visitor-stats" aria-busy={loading}>
      <div className="admin-panel-head admin-visitor-heading">
        <div>
          <h2>방문 통계</h2>
          <p>한국시간 기준 순방문자 현황과 기간별 추이를 확인합니다.</p>
        </div>
        <button
          type="button"
          className="admin-primary-mini-btn"
          onClick={reloadAll}
          disabled={anyLoading}
        >
          {anyLoading ? '불러오는 중...' : '통계 새로고침'}
        </button>
      </div>

      <div className="admin-visitor-summary-grid" aria-label="방문자 요약">
        {summaryItems.map((item) => (
          <article key={item.key}>
            <span>{item.label}</span>
            <strong>{formatCount(item.value, hasData)}<small>{hasData ? '명' : ''}</small></strong>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <div className="admin-visitor-controls">
        <div className="admin-visitor-period-control" role="group" aria-label="통계 기간 선택">
          {PERIOD_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={period === option.value ? 'is-active' : ''}
              aria-pressed={period === option.value}
              onClick={() => setPeriod?.(option.value)}
              disabled={loading && period === option.value}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="admin-visitor-anchor-control">
          기준 날짜
          <input
            type="date"
            value={anchor}
            onChange={(event) => setAnchor?.(event.target.value)}
            aria-label="방문 통계 기준 날짜"
          />
        </label>
      </div>

      {error && (
        <div className="admin-alert admin-alert-error admin-visitor-state" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => reload?.()} disabled={loading}>다시 시도</button>
        </div>
      )}

      {!error && loading && !hasData && (
        <div className="admin-visitor-state admin-visitor-loading" role="status">
          <span className="admin-visitor-spinner" aria-hidden="true" />
          방문 통계를 불러오는 중입니다.
        </div>
      )}

      {!error && !loading && !hasData && (
        <div className="admin-visitor-state admin-visitor-empty" role="status">
          아직 조회된 방문 통계가 없습니다. 새로고침하여 데이터를 확인해 주세요.
        </div>
      )}

      {hasData && (
        <div className="admin-visitor-chart-card">
          <div className="admin-visitor-chart-head">
            <div>
              <h3>{selectedPeriod.description} 방문자</h3>
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
              선택한 기간의 방문자는 0명입니다. 집계 오류가 아니라 실제 0건 데이터일 수 있습니다.
            </div>
          )}

          <VisitorTrendChart
            points={series}
            title={`${selectedPeriod.label} 방문자 추이`}
          />

          <div className="admin-visitor-meta">
            <span>집계 기준: 동일 브라우저는 하루 1회</span>
            {data.startedAt && <span>집계 시작일: {data.startedAt}</span>}
          </div>
        </div>
      )}

      <AdminMemberLoginStatsSection
        stats={memberLoginStats}
        period={period}
        anchor={anchor}
      />
    </section>
  );
}

export default function AdminVisitorStatsTab(props) {
  return <AdminVisitorSessionStatsTab {...props} />;
}
