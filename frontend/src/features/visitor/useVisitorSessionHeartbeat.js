import { useCallback, useEffect, useState } from 'react';

import { touchVisitorSession } from './visitorClient.js';

export const VISITOR_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RETRY_DELAY_MS = 1500;

export default function useVisitorSessionHeartbeat() {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');

  const applyTouchResult = useCallback((nextSummary, isInitial = false) => {
    if (nextSummary) {
      setSummary(nextSummary);
      setStatus('ready');
      return true;
    }
    if (isInitial) setStatus('error');
    return false;
  }, []);

  useEffect(() => {
    let isActive = true;
    let retryTimer = null;

    const touch = async ({ isInitial = false, canRetry = false } = {}) => {
      if (document.visibilityState === 'hidden') return null;
      const nextSummary = await touchVisitorSession();
      if (!isActive) return nextSummary;

      if (!nextSummary && canRetry) {
        retryTimer = window.setTimeout(
          () => touch({ isInitial: true, canRetry: false }),
          RETRY_DELAY_MS,
        );
        return null;
      }

      applyTouchResult(nextSummary, isInitial);
      return nextSummary;
    };

    const touchWhenVisible = () => {
      if (document.visibilityState !== 'hidden') touch();
    };

    touch({ isInitial: true, canRetry: true });

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
  }, [applyTouchResult]);

  return { summary, status };
}
