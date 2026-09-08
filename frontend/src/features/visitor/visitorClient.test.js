import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

import { getAdminClientId } from '../../admin/adminSession.js';
import { getOrCreateWgsClientId, normalizeVisitReceipt, touchVisitorSession } from './visitorClient.js';

test('a collection acknowledgement is accepted without public counts or session data', () => {
  assert.deepEqual(normalizeVisitReceipt({
    success: true, counted: false, ignored: true, reason: 'admin_excluded',
  }), { success: true, counted: false, ignored: true, reason: 'admin_excluded' });
  assert.deepEqual(normalizeVisitReceipt({
    success: true, counted: true, ignored: false,
    todayCount: 4, totalCount: 20, session: { visitorType: 'member' },
  }), { success: true, counted: true, ignored: false, reason: null });
});

test('failed or incomplete collection acknowledgements are rejected', () => {
  for (const payload of [null, {}, { success: false }, { todayCount: 1, totalCount: 2 },
    { success: true, counted: true }, { success: true, counted: 'true', ignored: false }]) {
    assert.equal(normalizeVisitReceipt(payload), null);
  }
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

test('ACK collection coalesces requests, throttles successful touches and retries a failed touch', async () => {
  const previousWindow = globalThis.window;
  const previousAdapter = axios.defaults.adapter;
  const requests = [];
  const storedClientId = 'wgs-11111111-2222-4333-8444-555555555555';
  globalThis.window = {
    localStorage: { getItem: () => storedClientId },
    location: { pathname: '/study' },
  };
  let failNext = false;
  axios.defaults.adapter = async (config) => {
    requests.push(config);
    if (failNext) { failNext = false; throw new Error('temporary test failure'); }
    return {
      data: { success: true, counted: false, ignored: false, reason: 'active_session' },
      status: 200, statusText: 'OK', headers: {}, config,
    };
  };
  try {
    const first = touchVisitorSession({ force: true, now: 1_000_000 });
    assert.equal(touchVisitorSession({ now: 1_000_000 }), first);
    const receipt = await first;
    assert.equal(receipt.success, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/visitors/visit');
    assert.equal(requests[0].headers.get('X-WGS-Client-Id'), storedClientId);
    assert.deepEqual(JSON.parse(requests[0].data), { entryPath: '/study' });
    assert.deepEqual(await touchVisitorSession({ now: 1_044_999 }), receipt);
    assert.equal(requests.length, 1);

    failNext = true;
    assert.equal(await touchVisitorSession({ now: 1_046_000 }), null);
    assert.equal((await touchVisitorSession({ now: 1_046_001 })).success, true);
    assert.equal(requests.length, 3);
  } finally {
    axios.defaults.adapter = previousAdapter;
    globalThis.window = previousWindow;
  }
});
