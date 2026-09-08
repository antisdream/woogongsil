import useVisitorSessionHeartbeat from './useVisitorSessionHeartbeat.js';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Mounted once in App's shared footer, independently of the selected page.
export default function VisitorStats() {
  const summary = useVisitorSessionHeartbeat();
  const count = (value) => summary ? `${numberFormat.format(value)}회` : '—';

  return (
    <div className="ui-visitor-stats">
      <dl aria-label="방문 통계">
        <div><dt>오늘 방문</dt><dd>{count(summary?.todayCount)}</dd></div>
        <div><dt>누적 방문</dt><dd>{count(summary?.totalCount)}</dd></div>
      </dl>
      <span className="ui-visitor-note">{summary ? '한국시간 기준' : '방문 통계 연결 중'}</span>
    </div>
  );
}
