import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVisitorFilterParams,
  getWeekRangeText,
  normalizeMemberIds,
  normalizeVisitorMembersResponse,
  normalizeVisitorSessionsResponse,
  normalizeVisitorStatsResponse,
  normalizeVisitorTypes,
} from './adminVisitorStatsUtils.js';

test('visitor type and member filters are normalized without duplicates', () => {
  assert.deepEqual(normalizeVisitorTypes(['MEMBER', 'anonymous', 'member']), ['member', 'anonymous']);
  assert.deepEqual(normalizeVisitorTypes([]), ['anonymous', 'member']);
  assert.deepEqual(normalizeMemberIds(['user1', '', 'user1', 'user2']), ['user1', 'user2']);
});

test('stats and session requests share the same filter query', () => {
  const query = buildVisitorFilterParams({
    period: 'month',
    anchor: '2026-05-01',
    visitorTypes: ['member'],
    memberIds: ['user1', 'user2'],
    status: 'active',
    page: 2,
    pageSize: 25,
  });

  assert.equal(query.get('period'), 'month');
  assert.equal(query.get('anchor'), '2026-05-01');
  assert.equal(query.get('types'), 'member');
  assert.equal(query.get('memberIds'), 'user1,user2');
  assert.equal(query.get('status'), 'active');
  assert.equal(query.get('page'), '2');
  assert.equal(query.get('pageSize'), '25');
});

test('visitor stats response includes session and raw-login metrics', () => {
  const normalized = normalizeVisitorStatsResponse({
    success: true,
    period: 'week',
    anchor: '2026-05-08',
    range: { start: '2026-05-04', end: '2026-05-10' },
    summary: { today: 2, thisWeek: 9, thisMonth: 12, thisYear: 20, total: 30 },
    metrics: {
      sessionCount: 9,
      anonymousCount: 4,
      memberCount: 5,
      uniqueMembers: 3,
      loginCount: 8,
    },
    series: [{ key: '2026-05-08', label: '금', sessionCount: 4 }],
  }, 'day', '2026-05-01');

  assert.equal(normalized.period, 'week');
  assert.equal(normalized.summary.total, 30);
  assert.equal(normalized.metrics.anonymousSessions, 4);
  assert.equal(normalized.metrics.memberSessions, 5);
  assert.equal(normalized.metrics.loginCount, 8);
  assert.equal(normalized.metrics.totalSessions, 9);
  assert.equal(normalized.series[0].count, 4);
});

test('session response exposes only the administrator-safe projection', () => {
  const normalized = normalizeVisitorSessionsResponse({
    success: true,
    pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    sessions: [{
      id: 'row-1',
      visitorType: 'member',
      member: { id: 'member1', name: '회원 1' },
      startedAt: '2026-05-08 09:00:00',
      lastSeenAt: '2026-05-08 09:03:00',
      durationSeconds: 180,
      status: 'ended',
      entryPath: '/login',
      source: 'login_history',
      historical: true,
      ip: 'should-not-be-forwarded',
      clientHash: 'should-not-be-forwarded',
      sessionToken: 'should-not-be-forwarded',
    }],
  }, 1, 25);

  assert.equal(normalized.sessions[0].member.id, 'member1');
  assert.equal(normalized.sessions[0].historical, true);
  assert.equal(normalized.sessions[0].source, 'login_history');
  assert.equal('ip' in normalized.sessions[0], false);
  assert.equal('clientHash' in normalized.sessions[0], false);
  assert.equal('sessionToken' in normalized.sessions[0], false);
});

test('member options and Monday-to-Sunday week label are normalized', () => {
  assert.deepEqual(normalizeVisitorMembersResponse({
    members: [{ id: 'a', name: '가' }, { id: '', name: '제외' }],
  }), [{ id: 'a', name: '가', sessionCount: 0, lastSeenAt: null }]);
  assert.equal(getWeekRangeText('2026-08-05'), '2026-08-03 ~ 2026-08-09');
  assert.equal(getWeekRangeText('2026-08-09'), '2026-08-03 ~ 2026-08-09');
});
