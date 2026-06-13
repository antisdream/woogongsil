// Frontend feature module for rankingHistoryData.
export const API_ENDPOINTS = ["/api/my-ranking-history-v2", "/api/my-ranking-history"];

export const TYPE_OPTIONS = [
  { value: "random", label: "필기 문제은행" },
  { value: "past", label: "필기 기출문제" },
  { value: "ipep_random", label: "실기 문제은행" },
  { value: "ipep_past", label: "실기 기출문제" },
];

export const METRIC_OPTIONS = [
  { value: "score", label: "점수" },
  { value: "accuracy", label: "정답률" },
];

export const PERIOD_OPTIONS = [
  { value: "daily", label: "일별" },
  { value: "weekly", label: "주별" },
  { value: "monthly", label: "월별" },
];

export function pad2(value) {
  return String(value).padStart(2, "0");
}

export function toYmd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayYmd() {
  const now = new Date();
  return toYmd(now);
}

export function addDays(ymd, amount) {
  const date = new Date(`${ymd}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toYmd(date);
}

export function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function normalizeDateValue(value) {
  if (!value) return "";
  const text = String(value);

  const matched = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${pad2(matched[2])}-${pad2(matched[3])}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return toYmd(parsed);

  return "";
}

export function formatMd(ymd) {
  const date = normalizeDateValue(ymd);
  if (!date) return "";
  return date.slice(5).replace("-", "-");
}

export function formatMonth(ymd) {
  const date = normalizeDateValue(ymd);
  if (!date) return "";
  return date.slice(0, 7).replace("-", ".");
}

export function listDays(startDate, endDate) {
  const start = normalizeDateValue(startDate);
  const end = normalizeDateValue(endDate);
  if (!isValidYmd(start) || !isValidYmd(end)) return [];

  const result = [];
  let current = start;
  let safety = 0;

  while (current <= end && safety < 370) {
    result.push(current);
    current = addDays(current, 1);
    safety += 1;
  }

  return result;
}

export function getSundayOfWeek(ymd) {
  const dateText = normalizeDateValue(ymd);
  const date = new Date(`${dateText}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return toYmd(date);
}

export function normalizeType(value) {
  const raw = String(value || "").trim();

  if (["random", "past", "ipep_random", "ipep_past"].includes(raw)) return raw;

  if (raw.includes("실기") && raw.includes("기출")) return "ipep_past";
  if (raw.includes("실기") && raw.includes("문제은행")) return "ipep_random";
  if (raw.includes("필기") && raw.includes("기출")) return "past";
  if (raw.includes("필기") && raw.includes("문제은행")) return "random";

  return "random";
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function firstNumber(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;

    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";

    const json = window.atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function addCandidate(set, value) {
  const text = String(value ?? "").trim();

  if (!text) return;
  if (text === "undefined" || text === "null") return;
  if (text.length >120) return;
  if (/^eyJ[a-zA-Z0-9_-]+\./.test(text)) return;

  set.add(text);
}

export function collectUserCandidatesFromObject(set, obj) {
  if (!obj || typeof obj !== "object") return;

  const priorityKeys = [
    "userId",
    "userid",
    "user_id",
    "loginId",
    "login_id",
    "id",
    "username",
    "userName",
    "name",
    "nickname",
    "email",
  ];

  for (const key of priorityKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      addCandidate(set, obj[key]);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") collectUserCandidatesFromObject(set, value);
  }
}

export function parsePossibleStoredValue(set, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return;

  // JWT 토큰이면 payload 안의 userId 후보를 확인합니다.
  if (/^eyJ[a-zA-Z0-9_-]+\./.test(raw)) {
    const payload = decodeJwtPayload(raw);
    collectUserCandidatesFromObject(set, payload);
    return;
  }

  // JSON 문자열이면 내부 객체에서 후보를 수집합니다.
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      const parsed = JSON.parse(raw);
      collectUserCandidatesFromObject(set, parsed);
      return;
    } catch {
      // JSON 파싱 실패 시 아래 일반 문자열 후보 처리로 넘어간다.
    }
  }

  addCandidate(set, raw);
}

export function storageKeys(storage) {
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
  } catch {
    // storage 접근 실패는 무시합니다.
  }
  return keys;
}

export function getStoredToken() {
  const tokenKeys = ["token", "accessToken", "access_token", "jwt", "authToken", "wgsToken"];

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of tokenKeys) {
      try {
        const value = storage.getItem(key);
        if (value && /^eyJ/.test(value)) return value;
      } catch {
        // 무시
      }
    }
  }

  return "";
}

export function getUserIdCandidates() {
  const result = new Set();

  const importantKeys = [
    "user",
    "currentUser",
    "loginUser",
    "wgsUser",
    "authUser",
    "userInfo",
    "member",
    "profile",
    "id",
    "userId",
    "loginId",
    "username",
    "name",
    "token",
    "accessToken",
    "access_token",
    "jwt",
    "authToken",
    "wgsToken",
  ];

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of importantKeys) {
      try {
        parsePossibleStoredValue(result, storage.getItem(key));
      } catch {
        // 무시
      }
    }

    for (const key of storageKeys(storage)) {
      try {
        const value = storage.getItem(key);
        if (value && value.length < 4000) parsePossibleStoredValue(result, value);
      } catch {
        // 무시
      }
    }
  }

  return Array.from(result);
}

export async function getServerUserCandidates() {
  const endpoints = [
    "/api/me",
    "/api/auth/me",
    "/api/current-user",
    "/api/user/me",
    "/api/profile",
  ];

  const set = new Set();

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) continue;

      const json = await res.json().catch(() => null);
      collectUserCandidatesFromObject(set, json);
    } catch {
      // 존재하지 않는 API는 무시합니다.
    }
  }

  return Array.from(set);
}

export function extractRows(json) {
  if (!json) return [];

  const candidates = [
    json.rows,
    json.history,
    json.data,
    json.results,
    json.rankings,
    json.records,
    json.list,
    json?.data?.rows,
    json?.data?.history,
    json?.data?.results,
    json?.data?.rankings,
    json?.result?.rows,
    json?.result?.history,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }

  return [];
}

export function normalizeHistoryRow(row) {
  const date =
    normalizeDateValue(
      row?.date ||
        row?.rankingDate ||
        row?.ranking_date ||
        row?.day ||
        row?.createdAt ||
        row?.created_at ||
        row?.savedAt ||
        row?.updatedAt
    ) || "";

  const solvedCount = firstNumber(row, [
    "solved_count",
    "solvedCount",
    "totalCount",
    "total_count",
    "attemptedCount",
    "attempted_count",
    "questionCount",
    "question_count",
    "total",
  ]);

  const correctCount = firstNumber(row, [
    "correct_count",
    "correctCount",
    "correct",
    "rightCount",
    "right_count",
  ]);

  let score = firstNumber(row, [
    "score",
    "totalScore",
    "total_score",
    "points",
    "point",
    "dailyScore",
    "bestScore",
  ]);

  if (score === null) {
    // 기존 랭킹은 문제당 5점으로 관리되는 구조가 있어 solved/correct 기반 점수를 보정합니다.
    score = safeNumber(correctCount, 0) * 5;
  }

  let accuracy = firstNumber(row, [
    "accuracy",
    "accuracyRate",
    "accuracy_rate",
    "correctRate",
    "correct_rate",
    "rate",
    "percent",
  ]);

  if (accuracy !== null && accuracy >0 && accuracy <= 1) {
    accuracy *= 100;
  }

  if ((accuracy === null || !Number.isFinite(accuracy)) && solvedCount && solvedCount >0) {
    accuracy = (safeNumber(correctCount, 0) / solvedCount) * 100;
  }

  return {
    raw: row,
    date,
    score: Math.max(0, Math.round(safeNumber(score, 0))),
    accuracy: Math.max(0, Math.min(100, Math.round(safeNumber(accuracy, 0)))),
    solvedCount: safeNumber(solvedCount, 0),
    correctCount: safeNumber(correctCount, 0),
  };
}

export function aggregateRows(rows, startDate, endDate, periodMode) {
  const normalized = rows
    .map(normalizeHistoryRow)
    .filter((row) => row.date && row.date >= startDate && row.date <= endDate);

  const bucket = new Map();

  function ensureBucket(key, label) {
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        label,
        score: 0,
        accuracyTotal: 0,
        accuracyCount: 0,
        solvedCount: 0,
        correctCount: 0,
        recordCount: 0,
      });
    }
    return bucket.get(key);
  }

  if (periodMode === "daily") {
    for (const day of listDays(startDate, endDate)) {
      ensureBucket(day, formatMd(day));
    }
  }

  for (const row of normalized) {
    let key = row.date;
    let label = formatMd(row.date);

    if (periodMode === "weekly") {
      const sunday = getSundayOfWeek(row.date);
      const saturday = addDays(sunday, 6);
      key = sunday;
      label = `${formatMd(sunday)}~${formatMd(saturday)}`;
    }

    if (periodMode === "monthly") {
      key = row.date.slice(0, 7);
      label = formatMonth(row.date);
    }

    const target = ensureBucket(key, label);
    target.score += row.score;
    target.solvedCount += row.solvedCount;
    target.correctCount += row.correctCount;
    target.recordCount += 1;

    if (row.accuracy >0 || row.solvedCount >0 || row.score >0) {
      target.accuracyTotal += row.accuracy;
      target.accuracyCount += 1;
    }
  }

  const points = Array.from(bucket.values())
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .map((item) => {
      let accuracy = 0;

      if (item.solvedCount >0) {
        accuracy = Math.round((item.correctCount / item.solvedCount) * 100);
      } else if (item.accuracyCount >0) {
        accuracy = Math.round(item.accuracyTotal / item.accuracyCount);
      }

      return {
        ...item,
        accuracy: Math.max(0, Math.min(100, accuracy)),
      };
    });

  return { points, normalized };
}
