import React, { useMemo } from 'react';

import { getKstDateText, getWeekRangeText } from '../adminVisitorStatsUtils.js';
import AdminVisitorSessionList from './AdminVisitorSessionList.jsx';
import VisitorTrendChart from './VisitorTrendChart.jsx';
import '../../../styles/admin/admin-visitor-stats.css';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');
const PERIOD_OPTIONS = [
  { value: 'day', label: '일간', description: '선택일 시간대별' },
  { value: 'week', label: '주간', description: '선택 주 일별' },
  { value: 'month', label: '월간', description: '선택 월 일별' },
  { value: 'year', label: '연간', description: '선택 연도 월별' },
];
const TYPE_OPTIONS = [
  { value: 'all', label: '전체', types: ['anonymous', 'member'] },
  { value: 'member', label: '회원', types: ['member'] },
  { value: 'anonymous', label: '비회원', types: ['anonymous'] },
];
const STATUS_OPTIONS = [
  { value: '', label: '전체 상태' },
  { value: 'active', label: '활동 중' },
  { value: 'ended', label: '종료 추정' },
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

function getSelectedType(visitorTypes) {
  if (visitorTypes.includes('anonymous') && visitorTypes.includes('member')) return 'all';
  return visitorTypes.includes('member') ? 'member' : 'anonymous';
}

function PeriodAnchorPicker({ period, anchor, setAnchor, data }) {
  const currentYear = Number(getKstDateText().slice(0, 4));
  const selectedYear = Number(anchor.slice(0, 4)) || currentYear;
  const startedYear = Number(String(data?.startedAt || '').slice(0, 4));
  const firstYear = Number.isFinite(startedYear) && startedYear > 2000
    ? Math.min(startedYear, selectedYear)
    : Math.min(currentYear - 5, selectedYear);
  const years = [];
  for (let year = currentYear + 1; year >= firstYear; year -= 1) years.push(year);

  if (period === 'month') {
    return (
      <label className="admin-visitor-anchor-control">
        기준 월
        <input
          type="month"
          value={anchor.slice(0, 7)}
          onChange={(event) => setAnchor?.(`${event.target.value}-01`)}
          aria-label="방문 통계 기준 월"
        />
      </label>
    );
  }

  if (period === 'year') {
    return (
      <label className="admin-visitor-anchor-control">
        기준 연도
        <select
          value={selectedYear}
          onChange={(event) => setAnchor?.(`${event.target.value}-01-01`)}
          aria-label="방문 통계 기준 연도"
        >
          {years.map((year) => <option key={year} value={year}>{year}년</option>)}
        </select>
      </label>
    );
  }

  return (
    <label className="admin-visitor-anchor-control">
      {period === 'week' ? '기준일' : '기준 날짜'}
      <input
        type="date"
        value={anchor}
        onChange={(event) => setAnchor?.(event.target.value)}
        aria-label={period === 'week' ? '방문 통계 주간 기준일' : '방문 통계 기준 날짜'}
      />
      {period === 'week' && <small>{getWeekRangeText(anchor)}</small>}
    </label>
  );
}

export default function AdminVisitorSessionStatsTab({
  data = null,
  period = 'day',
  setPeriod,
  anchor = '',
  setAnchor,
  visitorTypes = ['anonymous', 'member'],
  setVisitorTypes,
  memberIds = [],
  setMemberIds,
  sessionStatus = '',
  setSessionStatus,
  members = [],
  membersLoading = false,
  membersError = '',
  loading = false,
  error = '',
  reload,
  sessionsData = null,
  sessionsLoading = false,
  sessionsError = '',
  reloadSessions,
  sessionPage = 1,
  setSessionPage,
}) {
  const summary = data?.summary || {};
  const metrics = data?.metrics || {};
  const series = Array.isArray(data?.series) ? data.series : [];
  const hasData = Boolean(data);
  const displayedPeriod = data?.period || period;
  const selectedPeriod = PERIOD_OPTIONS.find((option) => option.value === displayedPeriod)
    || PERIOD_OPTIONS[0];
  const selectedType = getSelectedType(visitorTypes);
  const rangeText = getRangeText(data);
  const isStaleResult = Boolean(data && (data.period !== period || data.anchor !== anchor));
  const isZeroSeries = series.length > 0
    && series.every((point) => Number(point?.count || 0) === 0);
  const anyLoading = loading || sessionsLoading;
  const summaryItems = [
    { key: 'today', label: '오늘', value: summary.today, description: '오늘 방문 세션' },
    { key: 'thisWeek', label: '이번 주', value: summary.thisWeek, description: '이번 주 누적' },
    { key: 'thisMonth', label: '이번 달', value: summary.thisMonth, description: '이번 달 누적' },
    { key: 'thisYear', label: '올해', value: summary.thisYear, description: '올해 누적' },
    { key: 'total', label: '전체', value: summary.total, description: '기존 기록 포함 누적' },
  ];
  const selectedMemberLabels = useMemo(() => members
    .filter((member) => memberIds.includes(member.id))
    .map((member) => member.name || member.id), [memberIds, members]);

  const handleTypeSelect = (option) => {
    setVisitorTypes?.(option.types);
    if (option.value === 'anonymous') setMemberIds?.([]);
  };

  const handleMembersChange = (event) => {
    setMemberIds?.(Array.from(event.target.selectedOptions, (option) => option.value));
  };

  return (
    <section className="admin-panel admin-visitor-stats" aria-busy={anyLoading}>
      <div className="admin-panel-head admin-visitor-heading">
        <div>
          <h2>방문 통계</h2>
          <p>5분 활동 기준 방문 세션과 로그인 기록을 한국시간으로 조회합니다.</p>
        </div>
        <button
          type="button"
          className="admin-primary-mini-btn"
          onClick={() => reload?.()}
          disabled={anyLoading}
        >
          {anyLoading ? '불러오는 중...' : '통계 새로고침'}
        </button>
      </div>

      <div className="admin-visitor-summary-grid" aria-label="방문 세션 요약">
        {summaryItems.map((item) => (
          <article key={item.key}>
            <span>{item.label}</span>
            <strong>{formatCount(item.value, hasData)}<small>{hasData ? '회' : ''}</small></strong>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <div className="admin-visitor-controls admin-visitor-filter-panel">
        <div className="admin-visitor-period-control" role="group" aria-label="통계 기간 선택">
          {PERIOD_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={period === option.value ? 'is-active' : ''}
              aria-pressed={period === option.value}
              onClick={() => setPeriod?.(option.value)}
              disabled={loading && period === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <PeriodAnchorPicker period={period} anchor={anchor} setAnchor={setAnchor} data={data} />
      </div>

      <div className="admin-visitor-audience-filters">
        <fieldset>
          <legend>방문자 유형</legend>
          <div className="admin-visitor-type-options" role="group" aria-label="방문자 유형 선택">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={selectedType === option.value ? 'is-active' : ''}
                aria-pressed={selectedType === option.value}
                onClick={() => handleTypeSelect(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>세션 상태</legend>
          <div className="admin-visitor-type-options" role="group" aria-label="방문 세션 상태 선택">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value || 'all'}
                type="button"
                className={sessionStatus === option.value ? 'is-active' : ''}
                aria-pressed={sessionStatus === option.value}
                onClick={() => setSessionStatus?.(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="admin-visitor-member-select">
          회원 선택 <small>여러 회원을 선택할 수 있습니다. PC에서는 Ctrl 또는 Cmd를 함께 눌러 선택하세요.</small>
          <select
            multiple
            size={Math.min(6, Math.max(3, members.length || 3))}
            value={memberIds}
            onChange={handleMembersChange}
            disabled={!visitorTypes.includes('member') || membersLoading}
            aria-label="방문 통계 회원 다중 선택"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name || member.id} ({member.id})
              </option>
            ))}
          </select>
          <span>
            {membersLoading
              ? '회원 목록을 불러오는 중입니다.'
              : memberIds.length > 0
                ? `${selectedMemberLabels.join(', ')} 선택됨`
                : '선택하지 않으면 전체 회원을 조회합니다.'}
          </span>
          {memberIds.length > 0 && (
            <button type="button" onClick={() => setMemberIds?.([])}>회원 선택 해제</button>
          )}
        </label>
      </div>

      {membersError && <p className="admin-visitor-filter-warning" role="status">{membersError}</p>}

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
              <h3>{selectedPeriod.description} 방문 세션</h3>
              <p>{rangeText || anchor}{data.timezone && <span> · {data.timezone}</span>}</p>
            </div>
            {(loading || isStaleResult) && (
              <span className="admin-visitor-updating" role="status">
                {loading ? '업데이트 중...' : '이전 조회 결과'}
              </span>
            )}
          </div>

          <div className="admin-visitor-breakdown" aria-label="선택 조건 세션 구성">
            <span>비회원 <strong>{NUMBER_FORMATTER.format(metrics.anonymousSessions || 0)}회</strong></span>
            <span>회원 <strong>{NUMBER_FORMATTER.format(metrics.memberSessions || 0)}회</strong></span>
            <span>로그인 성공 <strong>{NUMBER_FORMATTER.format(metrics.loginCount || 0)}회</strong></span>
            <span>고유 회원 <strong>{NUMBER_FORMATTER.format(metrics.uniqueMembers || 0)}명</strong></span>
          </div>

          {isZeroSeries && (
            <div className="admin-visitor-zero-note" role="status">
              선택한 조건의 방문 세션은 0건입니다.
            </div>
          )}

          <VisitorTrendChart
            points={series}
            title={`${selectedPeriod.label} 방문 세션 추이`}
            metricLabel="방문 세션"
            unit="회"
            emptyMessage="선택한 조건에 표시할 방문 세션이 없습니다."
            zeroMessage="선택 기간의 방문 세션이 0건입니다."
          />

          <div className="admin-visitor-meta">
            <span>집계 기준: {Math.round((data.inactivitySeconds || 300) / 60)}분 이내 활동은 같은 세션</span>
            <span>회원 세션은 방문 중 로그인으로 식별된 세션이며, 로그인 성공은 별도 기록</span>
            <span>과거 보정값은 기존 일별 방문과 2026-05-08 이후 로그인 기록을 합산한 추정치</span>
            {data.startedAt && <span>집계 시작일: {String(data.startedAt).slice(0, 10)}</span>}
          </div>
        </div>
      )}

      <AdminVisitorSessionList
        data={sessionsData}
        loading={sessionsLoading}
        error={sessionsError}
        page={sessionPage}
        setPage={setSessionPage}
        reload={reloadSessions}
      />
    </section>
  );
}
