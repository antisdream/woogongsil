import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AdminApp from './admin/AdminApp.jsx';

import './index.css';
import './styles/admin/admin.css';
import './styles/admin/admin-dashboard.css';
import './styles/admin/admin-notice-maintenance.css';
import './styles/admin/admin-questions-tabs.css';
import './styles/admin/admin-display.css';
import './styles/admin/admin-user-approval.css';
import './styles/admin/admin-operation.css';
import './styles/admin/admin-user-overrides.css';
import './styles/admin/admin-approval-detail.css';
import './styles/admin/admin-theme-fixes.css';
import './styles/admin/admin-login.css';
import './styles/admin/admin-redesign.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminApp />
    </BrowserRouter>
  </React.StrictMode>
);
