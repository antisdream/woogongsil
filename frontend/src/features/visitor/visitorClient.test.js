import assert from 'node:assert/strict';
import test from 'node:test';

import { getAdminClientId } from '../../admin/adminSession.js';
import { getOrCreateWgsClientId, normalizeVisitorSummary } from './visitorClient.js';

test('public visitor response normalizes the 5-minute session payload', () => {
  const normalized = normalizeVisitorSummary({
    success: true,
    counted: false,
    todayCount: 4,
    totalCount: 20,
    timezone: 'Asia/Seoul',
    session: {
      visitorType: 'member',
      startedAt: '2026-08-05 10:00:00',
      lastSeenAt: '2026-08-05 10:01:00',
      idleTimeoutSeconds: 300,
    },
  });

  assert.equal(normalized.todayCount, 4);
  assert.equal(normalized.totalCount, 20);
  assert.equal(normalized.session.visitorType, 'member');
  assert.equal(normalized.session.idleTimeoutSeconds, 300);
});

test('invalid public counters are rejected', () => {
  assert.equal(normalizeVisitorSummary({ todayCount: -1, totalCount: 2 }), null);
  assert.equal(normalizeVisitorSummary(null), null);
});

test('public and dedicated administrator pages share one browser visit identity', () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  };

  try {
    const publicClientId = getOrCreateWgsClientId();
    assert.equal(getAdminClientId(), publicClientId);
    assert.equal(values.get('wgs_client_id'), publicClientId);
    assert.equal(values.has('wgs_admin_client_id'), false);
  } finally {
    globalThis.window = previousWindow;
  }
});
