import { useEffect, useState } from 'react';

import { fetchVisitorSummary, touchVisitorSession } from './visitorClient.js';

export const VISITOR_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RETRY_DELAY_MS = 1500;

export function startVisitorSessionHeartbeat({
  browserWindow = window,
  browserDocument = document,
  recordVisit = touchVisitorSession,
  readSummary = fetchVisitorSummary,
  onSummary,
} = {}) {
    let isActive = true;
    let retryTimer = null;

    const touch = async ({ canRetry = false } = {}) => {
      if (!isActive || browserDocument.visibilityState === 'hidden'
          || browserWindow.navigator?.onLine === false) return;
      const receipt = await recordVisit();
      if (!isActive) return;
      // Read after collection so a fresh uncached summary includes this visit.
      const summary = await readSummary();
      if (!isActive) return;
      onSummary(summary);

      if ((!receipt || !summary) && canRetry && retryTimer === null) {
        retryTimer = browserWindow.setTimeout(() => {
          retryTimer = null;
          touch();
        }, RETRY_DELAY_MS);
      }
    };

    const touchWhenVisible = () => {
      touch({ canRetry: true });
    };

    touch({ canRetry: true });
    const heartbeatTimer = browserWindow.setInterval(() => { touch(); }, VISITOR_HEARTBEAT_INTERVAL_MS);
    browserDocument.addEventListener('visibilitychange', touchWhenVisible);
    const events = ['focus', 'pageshow', 'online'];
    for (const event of events) browserWindow.addEventListener(event, touchWhenVisible);

    return () => {
      isActive = false;
      if (retryTimer !== null) browserWindow.clearTimeout(retryTimer);
      browserWindow.clearInterval(heartbeatTimer);
      browserDocument.removeEventListener('visibilitychange', touchWhenVisible);
      for (const event of events) browserWindow.removeEventListener(event, touchWhenVisible);
    };
}

export default function useVisitorSessionHeartbeat() {
  const [summary, setSummary] = useState(null);
  useEffect(() => startVisitorSessionHeartbeat({ onSummary: setSummary }), []);
  return summary;
}
