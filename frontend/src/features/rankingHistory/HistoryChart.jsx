// Frontend feature module for HistoryChart.
import React, { useState } from "react";

export default function HistoryChart({ points, metric, periodMode }) {
  // 차트 확대/축소 단계: 요청값 25%, 50%, 75%, 100%, 150%, 200%
  // 기본값은 100%로 고정합니다.
  const zoomSteps = [0.25, 0.5, 0.75, 1, 1.5, 2];
  const defaultZoomIndex = zoomSteps.indexOf(1);
  const [zoomIndex, setZoomIndex] = useState(defaultZoomIndex);
  const [hoverTip, setHoverTip] = useState(null);

  const safePoints = Array.isArray(points) ? points : [];
  const lowerMetric = String(metric || "").toLowerCase();
  const isRateMetric =
    lowerMetric.includes("rate") ||
    lowerMetric.includes("accuracy") ||
    lowerMetric.includes("correct") ||
    lowerMetric.includes("정답");

  const zoom = zoomSteps[zoomIndex] || 1;
  const zoomPercent = Math.round(zoom * 100);

  const periodName =
    periodMode === "weekly"? "주별 기록"
      : periodMode === "monthly"? "월별 기록"
        : "일별 기록";

  const metricName = isRateMetric ? "정답률" : "점수";

  function firstNumber(values, fallback = 0) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  function getValue(point) {
    if (isRateMetric) {
      return firstNumber([
        point?.correctRate,
        point?.correct_rate,
        point?.accuracy,
        point?.accuracyRate,
        point?.rate,
        point?.percent,
        point?.value,
        point?.y,
      ]);
    }

    return firstNumber([
      point?.score,
      point?.totalScore,
      point?.total_score,
      point?.point,
      point?.points,
      point?.value,
      point?.y,
    ]);
  }

  function getLabel(point, index) {
    return (
      point?.label ||
      point?.dateLabel ||
      point?.periodLabel ||
      point?.displayLabel ||
      point?.date ||
      point?.dateKey ||
      point?.day ||
      point?.month ||
      `기록 ${index + 1}`
    );
  }

  function formatValue(value) {
    if (isRateMetric) return `${Math.round(value)}%`;
    return `${Math.round(value)}점`;
  }

  const values = safePoints.map(getValue);
  const maxValue = values.length ? Math.max(...values, 0) : 0;
  const maxY = isRateMetric
    ? 100
    : Math.max(100, Math.ceil((maxValue + 10) / 50) * 50);

  const count = Math.max(safePoints.length, 1);

  // 긴 기간에서는 확대 시 가로 스크롤로 자세히 볼 수 있도록 SVG 폭을 조절합니다.
  const unitWidth =
    periodMode === "monthly"? 230
      : periodMode === "weekly"? 160
        : 42;

  const baseWidth = Math.max(980, count * unitWidth);
  const svgWidth = Math.max(760, Math.round(baseWidth * zoom));
  const svgHeight = 430;

  // 첫 번째 막대/점이 Y축과 겹치지 않도록 좌우 내부 여백을 넉넉하게 둡니다.
  const margin = {
    top: 38,
    right: 72,
    bottom: 78,
    left: 88,
  };

  const plotWidth = Math.max(1, svgWidth - margin.left - margin.right);
  const plotHeight = Math.max(1, svgHeight - margin.top - margin.bottom);
  const innerPadX = count <= 1 ? 0 : Math.max(34, Math.min(64, plotWidth * 0.04));
  const usablePlotWidth = Math.max(1, plotWidth - innerPadX * 2);

  function getX(index) {
    if (count <= 1) return margin.left + plotWidth / 2;
    return margin.left + innerPadX + (usablePlotWidth * index) / (count - 1);
  }

  function getY(value) {
    const safeValue = Math.max(0, Math.min(maxY, Number(value) || 0));
    return margin.top + plotHeight - (safeValue / maxY) * plotHeight;
  }

  const yTicks = isRateMetric
    ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    : Array.from({ length: 6 }, (_, i) => Math.round((maxY / 5) * i));

  const xLabelStep =
    periodMode === "daily"? zoom >= 1.5
        ? 1
        : zoom >= 1
          ? 2
          : zoom >= 0.75
            ? 4
            : 7
      : 1;

  const barWidth = Math.max(
    6,
    Math.min(
      periodMode === "daily"? 26 : 46,
      usablePlotWidth / Math.max(count, 1) * 0.52
    )
  );

  function showTooltip(event, point, index) {
    const value = getValue(point);
    const label = getLabel(point, index);

    const tooltipWidth = 190;
    const left = Math.min(
      Math.max(12, event.clientX + 18),
      Math.max(12, window.innerWidth - tooltipWidth - 18)
    );
    const top = Math.max(12, event.clientY - 42);

    setHoverTip({
      left,
      top,
      label,
      valueText: formatValue(value),
      metricName,
      periodName,
    });
  }

  function hideTooltip() {
    setHoverTip(null);
  }

  const canZoomOut = zoomIndex >0;
  const canZoomIn = zoomIndex < zoomSteps.length - 1;

  const zoomButtonStyle = (disabled) => ({
    width: "46px",
    height: "36px",
    borderRadius: "12px",
    border: "1px solid #cbd5e1",
    background: disabled ? "#f8fafc" : "#ffffff",
    color: disabled ? "#94a3b8" : "#111827",
    fontSize: "20px",
    fontWeight: 900,
    lineHeight: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    boxShadow: disabled ? "none" : "0 6px 16px rgba(15, 23, 42, 0.08)",
  });

  const zoomLabelStyle = {
    minWidth: "72px",
    height: "36px",
    borderRadius: "12px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#111827",
    fontSize: "14px",
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)",
  };

  if (safePoints.length === 0) {
    return (
      <div
        className="wgs-ranking-chart-wrap" style={{
          position: "relative",
          minHeight: "420px",
          border: "1px solid #e5e7eb",
          borderRadius: "20px",
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "420px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            fontWeight: 700,
          }}
        >
          선택한 조건의 랭킹 기록이 아직 없습니다.
        </div>
      </div>
    );
  }

  const linePath = safePoints
    .map((point, index) => {
      const x = getX(index);
      const y = getY(getValue(point));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div
      className="wgs-ranking-chart-wrap" style={{
        position: "relative",
        minHeight: "520px",
        border: "1px solid #e5e7eb",
        borderRadius: "20px",
        background: "#ffffff",
        overflow: "hidden",
        padding: "52px 20px 22px",
      }}
    >
      {/* 확대/축소 컨트롤: +, - 글자가 보이도록 색상과 크기를 인라인으로 강제합니다. */}
      <div
        className="wgs-chart-zoom-controls" style={{
          position: "absolute",
          top: "22px",
          right: "24px",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <button
          type="button" aria-label="차트 축소" title="차트 축소" disabled={!canZoomOut}
          onClick={() => setZoomIndex((prev) => Math.max(0, prev - 1))}
          style={zoomButtonStyle(!canZoomOut)}
        >
          −
        </button>

        <span style={zoomLabelStyle}>{zoomPercent}%</span>

        <button
          type="button" aria-label="차트 확대" title="차트 확대" disabled={!canZoomIn}
          onClick={() => setZoomIndex((prev) => Math.min(zoomSteps.length - 1, prev + 1))
          }
          style={zoomButtonStyle(!canZoomIn)}
        >
          +
        </button>
      </div>

      <div
        style={{
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: "10px",
        }}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img" aria-label="개인 랭킹 히스토리 차트" style={{
            display: "block",
            minWidth: `${svgWidth}px`,
          }}
        >
          {/* Y축 가로선 */}
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={svgWidth - margin.right}
                  y2={y}
                  stroke="#e5e7eb" strokeWidth="1"
                />
                <text
                  x={margin.left - 18}
                  y={y + 5}
                  textAnchor="end" fontSize="13" fontWeight="700" fill="#64748b"
                >
                  {isRateMetric ? `${tick}%` : tick}
                </text>
              </g>
            );
          })}

          {/* X축 수직 점선 가이드 */}
          {safePoints.map((point, index) => {
            const x = getX(index);
            const shouldShowGuide =
              periodMode !== "daily" || index % xLabelStep === 0;

            if (!shouldShowGuide) return null;

            return (
              <line
                key={`guide-${index}`}
                x1={x}
                y1={margin.top}
                x2={x}
                y2={margin.top + plotHeight}
                stroke="#bfdbfe" strokeWidth="1" strokeDasharray="4 8" opacity="0.8"
              />
            );
          })}

          {/* 축 */}
          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            stroke="#94a3b8" strokeWidth="2"
          />
          <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={svgWidth - margin.right}
            y2={margin.top + plotHeight}
            stroke="#94a3b8" strokeWidth="2"
          />

          {/* X축 라벨 */}
          {safePoints.map((point, index) => {
            const showLabel =
              index === 0 ||
              index === safePoints.length - 1 ||
              index % xLabelStep === 0;

            if (!showLabel) return null;

            const x = getX(index);
            const label = getLabel(point, index);

            return (
              <text
                key={`x-label-${index}`}
                x={x}
                y={margin.top + plotHeight + 34}
                textAnchor="middle" fontSize={periodMode === "daily"? 11 : 13}
                fontWeight="700" fill="#64748b"
              >
                {label}
              </text>
            );
          })}

          {/* 점수: 막대 그래프 */}
          {!isRateMetric &&
            safePoints.map((point, index) => {
              const value = getValue(point);
              const x = getX(index);
              const y = getY(value);
              const barHeight = margin.top + plotHeight - y;
              const labelY = Math.max(margin.top + 12, y - 8);

              return (
                <g key={`bar-${index}`}>
                  <rect
                    x={x - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={Math.max(4, barHeight)}
                    rx="8" fill="#60a5fa" opacity="0.95" onMouseEnter={(event) => showTooltip(event, point, index)}
                    onMouseMove={(event) => showTooltip(event, point, index)}
                    onMouseLeave={hideTooltip}
                    style={{ cursor: "pointer" }}
                  />
                  {value >0 && (
                    <text
                      x={x}
                      y={labelY}
                      textAnchor="middle" fontSize="12" fontWeight="900" fill="#2563eb"
                    >
                      {formatValue(value)}
                    </text>
                  )}

                  {/* hover 영역을 조금 넓혀서 작은 막대도 쉽게 잡히게 합니다. */}
                  <rect
                    x={x - Math.max(barWidth, 26) / 2}
                    y={margin.top}
                    width={Math.max(barWidth, 26)}
                    height={plotHeight}
                    fill="transparent" onMouseEnter={(event) => showTooltip(event, point, index)}
                    onMouseMove={(event) => showTooltip(event, point, index)}
                    onMouseLeave={hideTooltip}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              );
            })}

          {/* 정답률: 꺾은선 그래프 */}
          {isRateMetric && (
            <>
              <path
                d={linePath}
                fill="none" stroke="#ef4444" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"
              />

              {safePoints.map((point, index) => {
                const value = getValue(point);
                const x = getX(index);
                const y = getY(value);
                const radius = value >0 ? 6 : 3;
                const showValueLabel = value >0;

                return (
                  <g key={`dot-${index}`}>
                    <circle
                      cx={x}
                      cy={y}
                      r={radius}
                      fill="#ef4444" onMouseEnter={(event) => showTooltip(event, point, index)}
                      onMouseMove={(event) => showTooltip(event, point, index)}
                      onMouseLeave={hideTooltip}
                      style={{ cursor: "pointer" }}
                    />

                    {showValueLabel && (
                      <text
                        x={x}
                        y={Math.max(margin.top + 12, y - 12)}
                        textAnchor="middle" fontSize="12" fontWeight="900" fill="#ef4444"
                      >
                        {formatValue(value)}
                      </text>
                    )}

                    {/* hover 영역 확대 */}
                    <circle
                      cx={x}
                      cy={y}
                      r="15" fill="transparent" onMouseEnter={(event) => showTooltip(event, point, index)}
                      onMouseMove={(event) => showTooltip(event, point, index)}
                      onMouseLeave={hideTooltip}
                      style={{ cursor: "pointer" }}
                    />
                  </g>
                );
              })}
            </>
          )}
        </svg>
      </div>

      {hoverTip && (
        <div
          style={{
            position: "fixed",
            left: hoverTip.left,
            top: hoverTip.top,
            width: "190px",
            zIndex: 99999,
            padding: "14px 16px",
            borderRadius: "14px",
            background: "#1e293b",
            color: "#ffffff",
            boxShadow: "0 18px 45px rgba(15, 23, 42, 0.28)",
            pointerEvents: "none",
            fontSize: "14px",
            lineHeight: "1.55",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: "4px" }}>
            {hoverTip.label}
          </div>
          <div>
            {hoverTip.metricName}:{" "}
            <strong>{hoverTip.valueText}</strong>
          </div>
          <div style={{ color: "#cbd5e1", marginTop: "2px" }}>
            {hoverTip.periodName}
          </div>
        </div>
      )}
    </div>
  );
}
