import assert from 'node:assert/strict';
import test from 'node:test';
import { startVisitorSessionHeartbeat, VISITOR_HEARTBEAT_INTERVAL_MS } from './useVisitorSessionHeartbeat.js';

const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function environment() {
  const browserDocument = new EventTarget();
  browserDocument.visibilityState = 'visible';
  const browserWindow = new EventTarget();
  browserWindow.navigator = { onLine: true };
  const timeouts = new Map();
  let timerId = 0;
  browserWindow.setTimeout = (callback) => { timeouts.set(++timerId, callback); return timerId; };
  browserWindow.clearTimeout = (id) => timeouts.delete(id);
  const intervals = new Map();
  browserWindow.setInterval = (callback, delay) => {
    assert.equal(delay, VISITOR_HEARTBEAT_INTERVAL_MS);
    intervals.set(++timerId, callback); return timerId;
  };
  browserWindow.clearInterval = (id) => intervals.delete(id);
  return { browserDocument, browserWindow, timeouts, intervals };
}

test('collection runs before display, pauses while hidden/offline and resumes on browser or APK lifecycle events', async () => {
  const env = environment();
  const calls = [];
  const options = { ...env, recordVisit: async () => { calls.push('visit'); return { success: true }; },
    readSummary: async () => { calls.push('read'); return { todayCount: 1, totalCount: 10 }; },
    onSummary: () => { calls.push('display'); } };
  const stop = startVisitorSessionHeartbeat(options);
  await settle();
  assert.deepEqual(calls, ['visit', 'read', 'display']);
  env.browserDocument.visibilityState = 'hidden';
  env.browserDocument.dispatchEvent(new Event('visibilitychange'));
  for (const tick of env.intervals.values()) tick();
  await settle();
  assert.equal(calls.length, 3);
  env.browserDocument.visibilityState = 'visible';
  env.browserDocument.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(calls.length, 6);
  env.browserWindow.navigator.onLine = false;
  env.browserWindow.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(calls.length, 6);
  env.browserWindow.navigator.onLine = true;
  for (const name of ['online', 'pageshow', 'focus']) {
    env.browserWindow.dispatchEvent(new Event(name));
    await settle();
  }
  assert.equal(calls.length, 15);
  stop();
  assert.equal(env.intervals.size, 0);
  env.browserWindow.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(calls.length, 15);
});

test('a failed first request gets one retry and cleanup prevents late updates', async () => {
  const env = environment();
  let reads = 0;
  let displays = 0;
  let release;
  const stop = startVisitorSessionHeartbeat({ ...env,
    recordVisit: async () => null,
    readSummary: async () => { reads += 1; return reads === 1 ? null : new Promise(resolve => { release = resolve; }); },
    onSummary: () => { displays += 1; },
  });
  await settle();
  assert.equal(env.timeouts.size, 1);
  for (const [id, callback] of env.timeouts) { env.timeouts.delete(id); callback(); }
  await settle();
  assert.equal(reads, 2);
  stop();
  release({ todayCount: 0, totalCount: 10 });
  await settle();
  assert.equal(displays, 1);
  assert.equal(env.timeouts.size, 0);
  assert.equal(env.intervals.size, 0);
});
