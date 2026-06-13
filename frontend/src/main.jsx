/* rollback_check 우회 링크가 남아있어도 게이트키퍼를 건너뛰지 않도록 URL만 정리 */
try {
  const __wgsUrl = new URL(window.location.href);
  if (__wgsUrl.searchParams.has("rollback_check")) {
    __wgsUrl.searchParams.delete("rollback_check");
    window.history.replaceState({}, document.title, __wgsUrl.pathname + (__wgsUrl.search || "") + (__wgsUrl.hash || ""));
  }
} catch (e) {
  console.warn("[WGS] rollback_check cleanup skipped", e);
}


import React from 'react';

import ReactDOM from 'react-dom/client';

import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import GatekeeperGuard from './components/GatekeeperGuard.jsx';

import './index.css';



ReactDOM.createRoot(document.getElementById('root')).render(

  <BrowserRouter>

    <GatekeeperGuard>
      <App />
    </GatekeeperGuard>

  </BrowserRouter>

);

