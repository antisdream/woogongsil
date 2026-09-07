import test from 'node:test';
import assert from 'node:assert/strict';
import { getPersonalRankingRequestContext } from './rankingHistorySession.js';

const makeStorage = (values = {}) => ({ getItem: (key) => values[key] ?? null });

test('개인 기록은 현재 세션의 본인 ID와 WGS 인증 헤더만 사용한다', () => {
  const context = getPersonalRankingRequestContext(
    makeStorage({ userId: 'current-user', sessionToken: 'current-session', wgsServerInstanceId: 'current-server' }),
    makeStorage({ userId: 'previous-user', token: 'old-jwt', wgsServerInstanceId: 'old-server' }),
  );
  assert.deepEqual(context, {
    userId: 'current-user',
    headers: {
      Accept: 'application/json',
      'X-User-Id': 'current-user',
      'X-Session-Token': 'current-session',
      'X-Server-Instance-Id': 'current-server',
    },
  });
});

test('현재 세션이 없으면 이전 계정과 JWT가 남아 있어도 개인 기록을 요청하지 않는다', () => {
  const remembered = makeStorage({ userId: 'previous-user', sessionToken: 'old-session', token: 'old-jwt' });
  for (const incompleteSession of [{}, { userId: 'current-user' }, { sessionToken: 'current-session' }]) {
    assert.equal(getPersonalRankingRequestContext(makeStorage(incompleteSession), remembered), null);
  }
});

test('서버 인스턴스 값만 기존 로컬 저장값으로 보완할 수 있다', () => {
  const context = getPersonalRankingRequestContext(
    makeStorage({ userId: 'current-user', sessionToken: 'current-session' }),
    makeStorage({ userId: 'previous-user', wgsServerInstanceId: 'remembered-server' }),
  );
  assert.equal(context.userId, 'current-user');
  assert.equal(context.headers['X-Server-Instance-Id'], 'remembered-server');
});

test('서버 인스턴스를 모르면 해당 헤더를 보내지 않는다', () => {
  const context = getPersonalRankingRequestContext(
    makeStorage({ userId: 'current-user', sessionToken: 'current-session' }),
    makeStorage(),
  );
  assert.equal(Object.hasOwn(context.headers, 'X-Server-Instance-Id'), false);
});

test('세션 저장소를 읽지 못하면 개인 기록 요청을 허용하지 않는다', () => {
  const unavailableStorage = { getItem: () => { throw new Error('Storage unavailable'); } };
  assert.equal(getPersonalRankingRequestContext(unavailableStorage, makeStorage()), null);
});
