import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMemberLoginAnchor,
  normalizeMemberLoginPeriod,
  normalizeMemberLoginResponse,
  toMemberLoginCount,
} from './memberLoginStatsUtils.js';

test('member login count normalization clamps invalid values', () => {
  assert.equal(toMemberLoginCount('1,234'), 1234);
  assert.equal(toMemberLoginCount(4.6), 5);
  assert.equal(toMemberLoginCount(-1), 0);
  assert.equal(toMemberLoginCount('invalid'), 0);
});

test('period and anchor normalization reject unsupported values', () => {
  assert.equal(normalizeMemberLoginPeriod('WEEK'), 'week');
  assert.equal(normalizeMemberLoginPeriod('quarter'), 'day');
  assert.equal(normalizeMemberLoginAnchor('2026-05-08'), '2026-05-08');
  assert.match(normalizeMemberLoginAnchor('not-a-date'), /^\d{4}-\d{2}-\d{2}$/);
});

test('member login response keeps unavailable state distinct from an empty dataset', () => {
  const unavailable = normalizeMemberLoginResponse({
    success: true,
    available: false,
    reason: 'login_history_schema_unavailable',
    summary: {},
    series: [],
  }, 'month', '2026-08-04');

  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, 'login_history_schema_unavailable');
  assert.equal(unavailable.period, 'month');
  assert.equal(unavailable.summary.total, 0);
  assert.deepEqual(unavailable.series, []);
});

test('member login response normalizes daily unique member fields and series', () => {
  const normalized = normalizeMemberLoginResponse({
    success: true,
    available: true,
    period: 'week',
    anchor: '2026-05-08',
    timezone: 'Asia/Seoul',
    range: { start: '2026-05-04', end: '2026-05-10' },
    summary: {
      todayCount: 2,
      weekCount: '11',
      monthCount: 20,
      yearCount: 31,
      totalCount: 136,
      uniqueMemberCount: 7,
      rangeUniqueMemberCount: 4,
      startedAt: '2026-05-08',
    },
    series: [{ key: '2026-05-08', label: '05.08', count: '3' }],
    metadata: { dailyDeduplicated: true, adminExcluded: true },
  }, 'day', '2026-08-04');

  assert.equal(normalized.summary.today, 2);
  assert.equal(normalized.summary.thisWeek, 11);
  assert.equal(normalized.summary.total, 136);
  assert.equal(normalized.summary.uniqueMembers, 7);
  assert.equal(normalized.summary.rangeUniqueMembers, 4);
  assert.equal(normalized.summary.startedAt, '2026-05-08');
  assert.deepEqual(normalized.series, [{ key: '2026-05-08', label: '05.08', count: 3 }]);
  assert.equal(normalized.metadata.adminExcluded, true);
});
