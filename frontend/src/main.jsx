import { bootstrapMemberSession } from './features/memberSession.js';
/* 과거 점검 링크에 남아 있는 rollback_check 쿼리만 정리합니다. */
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

import './index.css';



bootstrapMemberSession().finally(() => ReactDOM.createRoot(document.getElementById('root')).render(

  <BrowserRouter>

    <App />

  </BrowserRouter>

));
