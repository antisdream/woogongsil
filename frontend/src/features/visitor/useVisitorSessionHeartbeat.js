import { useEffect } from 'react';

import { touchVisitorSession } from './visitorClient.js';

export const VISITOR_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RETRY_DELAY_MS = 1500;

export default function useVisitorSessionHeartbeat() {
  useEffect(() => {
    let isActive = true;
    let retryTimer = null;

    const touch = async ({ canRetry = false } = {}) => {
      if (!isActive || document.visibilityState === 'hidden') return;
      const receipt = await touchVisitorSession();
      if (!isActive) return;

      if (!receipt && canRetry) {
        retryTimer = window.setTimeout(() => touch(), RETRY_DELAY_MS);
      }
    };

    const touchWhenVisible = () => {
      if (document.visibilityState !== 'hidden') touch();
    };

    touch({ canRetry: true });
    const heartbeatTimer = window.setInterval(touchWhenVisible, VISITOR_HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', touchWhenVisible);
    window.addEventListener('focus', touchWhenVisible);
    window.addEventListener('pageshow', touchWhenVisible);

    return () => {
      isActive = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', touchWhenVisible);
      window.removeEventListener('focus', touchWhenVisible);
      window.removeEventListener('pageshow', touchWhenVisible);
    };
  }, []);
}
