// 개인 기록은 현재 로그인 탭의 WGS 세션으로만 요청합니다.
// 이전 계정의 저장값이나 JWT 내용은 사용자 ID 후보로 사용하지 않습니다.
export function getPersonalRankingRequestContext(sessionStorage, localStorage) {
  try {
    const userId = String(sessionStorage.getItem('userId') || '').trim();
    const sessionToken = String(sessionStorage.getItem('sessionToken') || '').trim();
    if (!userId || !sessionToken) return null;

    const headers = {
      Accept: 'application/json',
      'X-User-Id': userId,
      'X-Session-Token': sessionToken,
    };
    const serverInstanceId = String(
      sessionStorage.getItem('wgsServerInstanceId')
      || localStorage?.getItem('wgsServerInstanceId')
      || '',
    ).trim();
    if (serverInstanceId) headers['X-Server-Instance-Id'] = serverInstanceId;

    return { userId, headers };
  } catch {
    return null;
  }
}
