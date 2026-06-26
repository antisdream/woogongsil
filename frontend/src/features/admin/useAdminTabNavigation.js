import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_TABS,
  ADMIN_TAB_ROUTE_MAP,
  getAdminTabFromPath,
} from './adminUtils.js';

function useAdminTabNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminTabFromPath = getAdminTabFromPath(location.pathname);
  const [activeAdminTab, setActiveAdminTab] = useState(adminTabFromPath);

  const openAdminTab = useCallback((tabId, options = {}) => {
    const nextTab = ADMIN_TABS.some((tab) => tab.id === tabId) ? tabId : 'dashboard';
    setActiveAdminTab(nextTab);
    const nextPath = ADMIN_TAB_ROUTE_MAP[nextTab] || '/admin/dashboard';
    if (location.pathname !== nextPath) {
      navigate(nextPath, { replace: Boolean(options.replace) });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (adminTabFromPath !== activeAdminTab) {
      setActiveAdminTab(adminTabFromPath);
    }
  }, [adminTabFromPath, activeAdminTab]);

  return { activeAdminTab, openAdminTab };
}

export default useAdminTabNavigation;
