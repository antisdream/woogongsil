import useVisitorSessionHeartbeat from './useVisitorSessionHeartbeat.js';

// Keep visit collection independent of the public page's visible content.
export default function VisitorSessionHeartbeat() {
  useVisitorSessionHeartbeat();
  return null;
}
