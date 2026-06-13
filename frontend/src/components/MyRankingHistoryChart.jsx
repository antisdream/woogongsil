// Shared UI component used across frontend pages.
import React, { useEffect, useMemo, useState } from "react";
import {
  API_ENDPOINTS,
  TYPE_OPTIONS,
  METRIC_OPTIONS,
  PERIOD_OPTIONS,
  todayYmd,
  addDays,
  isValidYmd,
  normalizeType,
  safeNumber,
  getStoredToken,
  getUserIdCandidates,
  getServerUserCandidates,
  extractRows,
  aggregateRows,
} from "../features/rankingHistory/rankingHistoryData.js";

/**
 * 개인 랭킹 히스토리 차트
 * - 로그인 사용자만 Home.jsx에서 노출되는 컴포넌트
 * - 점수/정답률 탭 분리
 * - 일별/주별/월별 보기 지원
 * - API v2를 먼저 호출하고 실패 시 기존 API로 대체 처리합니다.
 * - localStorage/sessionStorage/JWT 안의 userId 후보를 모두 확인해 DB 연결 안정화
 */


import HistoryChart from "../features/rankingHistory/HistoryChart.jsx";

export default function MyRankingHistoryChart({ activeType = "random", targetUserId = null, titlePrefix = "개인", getHomeScreenSetting = null }) {
  const initialEnd = todayYmd();
  const initialStart = addDays(initialEnd, -20);

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [problemType, setProblemType] = useState(normalizeType(activeType));
  const [metric, setMetric] = useState("score");
  const [periodMode, setPeriodMode] = useState("daily");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState("");

  const getHistorySetting = (key, fallback) => {
    if (typeof getHomeScreenSetting !== "function") return fallback;
    return getHomeScreenSetting(`ranking_history.${key}`, fallback);
  };

  const historyTitlePrefix = getHistorySetting("title_prefix", titlePrefix);
  const historyTitleSuffix = getHistorySetting("title_suffix", "랭킹 히스토리");
  const historyDescMy = getHistorySetting("desc_my", "날짜와 문제 유형을 선택하면 내 점수와 정답률 변화를 확인할 수 있습니다.");
  const historyDescTarget = getHistorySetting("desc_target", "날짜와 문제 유형을 선택하면 해당 사용자의 점수와 정답률 변화를 확인할 수 있습니다.");
  const historyStartDateLabel = getHistorySetting("start_date_label", "시작일");
  const historyEndDateLabel = getHistorySetting("end_date_label", "종료일");
  const historyTypeLabel = getHistorySetting("type_label", "문제 유형");
  const historyQueryButtonLabel = getHistorySetting("query_button_label", "조회하기");
  const historyQueryLoadingLabel = getHistorySetting("query_loading_label", "조회중...");
  const historyScoreLabel = getHistorySetting("score_label", "점수");
  const historyAccuracyLabel = getHistorySetting("accuracy_label", "정답률");
  const historyRecordDaysLabel = getHistorySetting("record_days_label", "기록일");
  const historyDaySuffix = getHistorySetting("day_suffix", "일");
  const historyScoreUnit = getHistorySetting("score_unit", "점");
  const historyDateInvalidMessage = getHistorySetting("date_invalid_message", "날짜 형식이 올바르지 않습니다.");
  const historyDateRangeMessage = getHistorySetting("date_range_message", "시작일은 종료일보다 늦을 수 없습니다.");
  const historyLoadFailedMessage = getHistorySetting("load_failed_message", "랭킹 기록을 불러오지 못했습니다. 로그인 정보를 다시 확인해주세요.");
  const historyTypeOptions = TYPE_OPTIONS.map((option) => ({
    ...option,
    label: getHistorySetting(`type_${option.value}_label`, option.label),
  }));
  const historyMetricOptions = METRIC_OPTIONS.map((option) => ({
    ...option,
    label: getHistorySetting(`metric_${option.value}_label`, option.label),
  }));
  const historyPeriodOptions = PERIOD_OPTIONS.map((option) => ({
    ...option,
    label: getHistorySetting(`period_${option.value}_label`, option.label),
  }));

  useEffect(() => {
    setProblemType(normalizeType(activeType));
  }, [activeType]);

  const { points, normalized } = useMemo(() => {
    return aggregateRows(rows, startDate, endDate, periodMode);
  }, [rows, startDate, endDate, periodMode]);

  const summary = useMemo(() => {
    const validRows = normalized.filter(
      (row) => row.score >0 || row.accuracy >0 || row.solvedCount >0
    );

    const totalScore = validRows.reduce((sum, row) => sum + safeNumber(row.score, 0), 0);

    const totalSolved = validRows.reduce((sum, row) => sum + safeNumber(row.solvedCount, 0), 0);
    const totalCorrect = validRows.reduce((sum, row) => sum + safeNumber(row.correctCount, 0), 0);

    let accuracy = 0;

    if (totalSolved >0) {
      accuracy = Math.round((totalCorrect / totalSolved) * 100);
    } else if (validRows.length >0) {
      accuracy = Math.round(
        validRows.reduce((sum, row) => sum + safeNumber(row.accuracy, 0), 0) / validRows.length
      );
    }

    const recordDays = new Set(validRows.map((row) => row.date)).size;

    return {
      score: totalScore,
      accuracy,
      recordDays,
    };
  }, [normalized]);

  async function requestHistory() {
    if (!isValidYmd(startDate) || !isValidYmd(endDate)) {
      setLastMessage(historyDateInvalidMessage);
      setRows([]);
      return;
    }

    if (startDate >endDate) {
      setLastMessage(historyDateRangeMessage);
      setRows([]);
      return;
    }

    setLoading(true);
    setLastMessage("");

    try {
      const storageCandidates = targetUserId ? [String(targetUserId).trim()].filter(Boolean) : getUserIdCandidates();
      const serverCandidates = targetUserId ? [] : await getServerUserCandidates();
      const candidates = Array.from(new Set([...storageCandidates, ...serverCandidates]));

      const token = getStoredToken();
      const headers = { Accept: "application/json" };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const attempts = [];

      for (const endpoint of API_ENDPOINTS) {
        for (const userId of candidates) {
          const params = new URLSearchParams();

          // 기존 서버/새 서버 모두 대응하기 위해 날짜 파라미터 별칭을 함께 전달합니다.
          params.set("userId", userId);
          params.set("id", userId);
          params.set("type", normalizeType(problemType));
          params.set("source", normalizeType(problemType));
          params.set("startDate", startDate);
          params.set("endDate", endDate);
          params.set("start", startDate);
          params.set("end", endDate);
          params.set("from", startDate);
          params.set("to", endDate);

          const url = `${endpoint}?${params.toString()}`;

          try {
            const res = await fetch(url, {
              method: "GET",
              credentials: "include",
              headers,
            });

            const json = await res.json().catch(() => null);
            const extracted = extractRows(json);

            attempts.push({
              endpoint,
              userId,
              ok: res.ok,
              rows: extracted,
              json,
            });

            if (res.ok && extracted.length >0) {
              console.log("[MyRankingHistoryChart] ranking history loaded", {
                endpoint,
                userId,
                rows: extracted.length,
                type: normalizeType(problemType),
              });

              setRows(extracted);
              setLastMessage("");
              return;
            }
          } catch (err) {
            attempts.push({
              endpoint,
              userId,
              ok: false,
              rows: [],
              error: err?.message || String(err),
            });
          }
        }
      }

      const firstOk = attempts.find((item) => item.ok);
      if (firstOk) {
        setRows(firstOk.rows || []);
        setLastMessage("");
      } else {
        setRows([]);
        setLastMessage(historyLoadFailedMessage);
      }

      console.log("[MyRankingHistoryChart] ranking history attempts", attempts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    requestHistory();
    // activeType/problemType이 바뀔 때 홈 탭과 히스토리 탭을 맞춘다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemType]);

  const buttonBase = {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "9px 16px",
    background: "#fff",
    color: "#0f172a",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
  };

  const activeButton = (background) => ({
    ...buttonBase,
    borderColor: background,
    background,
    color: "#fff",
    boxShadow: "0 10px 20px rgba(15, 23, 42, 0.12)",
  });

  return (
    <section
      style={{
        width: "100%",
        border: "1px solid #dbe4ef",
        borderRadius: 18,
        background: "#f8fafc",
        padding: 22,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
             {historyTitlePrefix} {historyTitleSuffix}
          </h3>
          <p style={{ margin: "10px 0 0", color: "#64748b", fontWeight: 700 }}>
            {targetUserId ? historyDescTarget : historyDescMy}
          </p>
        </div>

        <button
          type="button" onClick={requestHistory}
          disabled={loading}
          style={{
            border: "none",
            borderRadius: 16,
            padding: "14px 22px",
            background: loading ? "#94a3b8" : "#10b981",
            color: "#fff",
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 14px 28px rgba(16, 185, 129, 0.22)",
          }}
        >
          {loading ? historyQueryLoadingLabel : historyQueryButtonLabel}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <label style={{ display: "grid", gap: 8, color: "#334155", fontWeight: 900 }}>
          {historyStartDateLabel}
          <input
            type="date" value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            style={{
              height: 44,
              border: "1px solid #dbe4ef",
              borderRadius: 12,
              padding: "0 12px",
              fontWeight: 800,
              color: "#0f172a",
              background: "#fff",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 8, color: "#334155", fontWeight: 900 }}>
          {historyEndDateLabel}
          <input
            type="date" value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            style={{
              height: 44,
              border: "1px solid #dbe4ef",
              borderRadius: 12,
              padding: "0 12px",
              fontWeight: 800,
              color: "#0f172a",
              background: "#fff",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 8, color: "#334155", fontWeight: 900 }}>
          {historyTypeLabel}
          <select
            value={problemType}
            onChange={(event) => setProblemType(normalizeType(event.target.value))}
            style={{
              height: 44,
              border: "1px solid #dbe4ef",
              borderRadius: 12,
              padding: "0 12px",
              fontWeight: 800,
              color: "#0f172a",
              background: "#fff",
            }}
          >
            {historyTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            borderRadius: 14,
            background: "#dbeafe",
            padding: 16,
            color: "#0f172a",
            fontWeight: 900,
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8 }}>{historyScoreLabel}</div>
          <div style={{ fontSize: 26 }}>{summary.score}{historyScoreUnit}</div>
        </div>

        <div
          style={{
            borderRadius: 14,
            background: "#dcfce7",
            padding: 16,
            color: "#0f172a",
            fontWeight: 900,
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8 }}>{historyAccuracyLabel}</div>
          <div style={{ fontSize: 26 }}>{summary.accuracy}%</div>
        </div>

        <div
          style={{
            borderRadius: 14,
            background: "#fef3c7",
            padding: 16,
            color: "#0f172a",
            fontWeight: 900,
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8 }}>{historyRecordDaysLabel}</div>
          <div style={{ fontSize: 26 }}>{summary.recordDays}{historyDaySuffix}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        {historyMetricOptions.map((option) => (
          <button
            key={option.value}
            type="button" onClick={() => setMetric(option.value)}
            style={
              metric === option.value
                ? activeButton(option.value === "accuracy"? "#ef4444" : "#2563eb")
                : buttonBase
            }
          >
            {option.label}
          </button>
        ))}

        <div style={{ width: 14 }} />

        {historyPeriodOptions.map((option) => (
          <button
            key={option.value}
            type="button" onClick={() => setPeriodMode(option.value)}
            style={periodMode === option.value ? activeButton("#10b981") : buttonBase}
          >
            {option.label}
          </button>
        ))}
      </div>

      {lastMessage && (
        <div
          style={{
            border: "1px solid #fed7aa",
            background: "#fff7ed",
            color: "#c2410c",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            fontWeight: 800,
          }}
        >
          {lastMessage}
        </div>
      )}

      <HistoryChart points={points} metric={metric} periodMode={periodMode} />
    </section>
  );
}


