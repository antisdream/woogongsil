import useVisitorSessionHeartbeat from './useVisitorSessionHeartbeat.js';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');

export default function VisitorCounter({ className = '' }) {
  const { summary, status } = useVisitorSessionHeartbeat();

  if (status === 'loading') {
    return (
      <span className="wgs-visitor-counter__sr-only" role="status" aria-live="polite">
        방문 통계를 불러오는 중입니다.
      </span>
    );
  }

  if (status === 'error' || !summary) return null;

  const rootClassName = ['wgs-visitor-counter', className].filter(Boolean).join(' ');

  return (
    <section
      className={rootClassName}
      aria-label="방문자 통계"
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <dl className="wgs-visitor-counter__counts">
        <div className="wgs-visitor-counter__item">
          <dt>오늘 방문</dt>
          <dd>{NUMBER_FORMATTER.format(summary.todayCount)}</dd>
        </div>
        <div className="wgs-visitor-counter__item">
          <dt>누적 방문</dt>
          <dd>{NUMBER_FORMATTER.format(summary.totalCount)}</dd>
        </div>
      </dl>
    </section>
  );
}
