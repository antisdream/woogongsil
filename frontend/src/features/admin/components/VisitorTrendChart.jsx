import React, { useId } from 'react';

const NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR');
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function toCount(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : 0;
}

function getNiceMaximum(maximum) {
  if (maximum <= 4) return 4;

  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const factor = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];

  return points.map((point, index) => ({
    key: String(point?.key ?? point?.date ?? index),
    label: String(point?.label ?? point?.date ?? point?.key ?? index + 1),
    count: toCount(point?.count ?? point?.value ?? point?.visitors),
  }));
}

export default function VisitorTrendChart({
  points = [],
  title = '방문자 추이',
  emptyMessage = '선택한 기간에 표시할 방문 기록이 없습니다.',
  metricLabel = '방문자',
  unit = '명',
  zeroMessage = '선택 기간의 방문자 수가 0명입니다.',
}) {
  const normalizedPoints = normalizePoints(points);
  const titleId = useId();
  const descriptionId = useId();

  if (normalizedPoints.length === 0) {
    return (
      <div className="admin-visitor-chart-empty" role="status">
        <span aria-hidden="true">▥</span>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const width = 960;
  const height = 330;
  const padding = { top: 28, right: 24, bottom: 62, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(...normalizedPoints.map((point) => point.count));
  const scaleMaximum = getNiceMaximum(maximum);
  const slotWidth = plotWidth / normalizedPoints.length;
  const barWidth = Math.max(4, Math.min(34, slotWidth * 0.62));
  const labelStep = Math.max(1, Math.ceil(normalizedPoints.length / 8));
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      value: Math.round(scaleMaximum * (1 - ratio)),
      y: padding.top + plotHeight * ratio,
    };
  });

  return (
    <div className="admin-visitor-chart-wrap">
      <svg
        className="admin-visitor-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>
          {`${normalizedPoints.length}개 구간의 ${metricLabel} 수를 나타낸 막대그래프입니다. 최대 ${NUMBER_FORMATTER.format(maximum)}${unit}입니다.`}
        </desc>

        <g className="admin-visitor-chart-grid" aria-hidden="true">
          {yTicks.map((tick) => (
            <g key={`y-${tick.y}`}>
              <line x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
              <text x={padding.left - 12} y={tick.y + 5} textAnchor="end">
                {COMPACT_NUMBER_FORMATTER.format(tick.value)}
              </text>
            </g>
          ))}
        </g>

        <line
          className="admin-visitor-chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight}
          y2={padding.top + plotHeight}
          aria-hidden="true"
        />

        <g className="admin-visitor-chart-bars">
          {normalizedPoints.map((point, index) => {
            const naturalHeight = (point.count / scaleMaximum) * plotHeight;
            const renderedHeight = point.count === 0 ? 2 : Math.max(3, naturalHeight);
            const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
            const y = padding.top + plotHeight - renderedHeight;
            const shouldShowLabel = index % labelStep === 0 || index === normalizedPoints.length - 1;

            return (
              <g
                key={`${point.key}-${index}`}
                className="admin-visitor-chart-bar-group"
                tabIndex="0"
                role="img"
                aria-label={`${point.label}: ${NUMBER_FORMATTER.format(point.count)}${unit}`}
              >
                <title>{`${point.label}: ${NUMBER_FORMATTER.format(point.count)}${unit}`}</title>
                <rect
                  className="admin-visitor-chart-bar"
                  x={x}
                  y={y}
                  width={barWidth}
                  height={renderedHeight}
                  rx={Math.min(5, barWidth / 3)}
                />
                {shouldShowLabel && (
                  <text
                    className="admin-visitor-chart-x-label"
                    x={x + barWidth / 2}
                    y={height - 27}
                    textAnchor="middle"
                    aria-hidden="true"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {maximum === 0 && (
          <text
            className="admin-visitor-chart-zero-label"
            x={padding.left + plotWidth / 2}
            y={padding.top + plotHeight / 2}
            textAnchor="middle"
          >
            {zeroMessage}
          </text>
        )}
      </svg>

      <div className="admin-visitor-sr-only">
        <table>
          <caption>{title} 상세 데이터</caption>
          <thead>
            <tr>
              <th scope="col">구간</th>
              <th scope="col">{metricLabel} 수</th>
            </tr>
          </thead>
          <tbody>
            {normalizedPoints.map((point, index) => (
              <tr key={`table-${point.key}-${index}`}>
                <th scope="row">{point.label}</th>
                <td>{NUMBER_FORMATTER.format(point.count)}{unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
