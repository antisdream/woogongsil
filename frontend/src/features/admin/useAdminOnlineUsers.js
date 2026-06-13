// 관리자 기능 모듈입니다: useAdminOnlineUsers
import { useCallback, useState } from 'react';
import {
  getStoredServerInstanceId,
  getStoredSessionToken,
  getStoredUser,
  getStoredUserId,
  getStoredUserName,
  isAdminAccessUser,
} from './adminUtils.js';

export default function useAdminOnlineUsers() {
  //  실시간 접속자 데이터 상태입니다.
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loadingOnline, setLoadingOnline] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [onlineFetchedAt, setOnlineFetchedAt] = useState(null);

  // 현재 서버 메모리에 남아 있는 실시간 접속자 목록을 조회합니다.
  // 기존 홈 화면의 접속자/채팅 기능에서 쓰던 /api/online-users API를 재사용해 DB 변경 없이 안전하게 연결합니다.
  const fetchOnlineUsers = useCallback(async () => {
    const user = getStoredUser();
    const token = getStoredSessionToken(user);

    if (!isAdminAccessUser(user)) return;

    setLoadingOnline(true);
    setOnlineError('');

    try {
      const response = await fetch('/api/online-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: getStoredUserId(user),
          name: getStoredUserName(user),
          sessionToken: token,
          // 서버 재시작 후 오래된 세션을 걸러내는 기존 프로젝트 로직을 그대로 사용합니다.
          serverInstanceId: getStoredServerInstanceId(user),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.msg || '실시간 접속자 정보를 불러오지 못했습니다.');
      }

      const normalizedUsers = Array.isArray(data.users)
        ? data.users.map((onlineUser) => ({
            id: onlineUser.id || onlineUser.userId || '-',
            name: onlineUser.name || onlineUser.userName || onlineUser.id || '-',
            lastSeen: onlineUser.lastSeen || onlineUser.updatedAt || onlineUser.connectedAt || onlineUser.lastSeenAt || null,
            connectedAt: onlineUser.connectedAt || onlineUser.createdAt || onlineUser.loginAt || onlineUser.lastSeen || null,
            ip: onlineUser.ip || onlineUser.ipAddress || '-',
            browser: onlineUser.browser || onlineUser.userAgent || onlineUser.device || '-',
          }))
        : [];

      setOnlineUsers(normalizedUsers);
      setOnlineFetchedAt(new Date());
    } catch (error) {
      console.error('[admin] online users fetch failed:', error);
      setOnlineError(error.message || '실시간 접속자 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingOnline(false);
    }
  }, []);

  return {
    onlineUsers,
    loadingOnline,
    onlineError,
    onlineFetchedAt,
    fetchOnlineUsers,
  };
}
