// 관리자 기능 모듈입니다: useAdminNoticeOperations
import { useCallback, useState } from 'react';
import {
  DEFAULT_MAINTENANCE_FORM,
  getStoredUser,
  isAdminAccessUser,
} from './adminUtils.js';

export default function useAdminNoticeOperations({
  makeAdminAuthBody,
  makeAdminHeaders,
}) {
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeLevel, setNoticeLevel] = useState('info');
  const [noticeHistory, setNoticeHistory] = useState([]);
  const [sendingNotice, setSendingNotice] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const [noticeSuccess, setNoticeSuccess] = useState('');

  const [operationLogType, setOperationLogType] = useState('notice');
  const [operationLogs, setOperationLogs] = useState([]);
  const [operationLogPage, setOperationLogPage] = useState(1);
  const [operationLogTotalPages, setOperationLogTotalPages] = useState(1);
  const [operationLogTotal, setOperationLogTotal] = useState(0);
  const [operationLogSort, setOperationLogSort] = useState('desc');
  const [loadingOperationLogs, setLoadingOperationLogs] = useState(false);
  const [operationLogError, setOperationLogError] = useState('');

  const [maintenanceForm, setMaintenanceForm] = useState(DEFAULT_MAINTENANCE_FORM);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintenanceSuccess, setMaintenanceSuccess] = useState('');

  const fetchNoticeHistory = useCallback(async () => {
    if (!isAdminAccessUser(getStoredUser())) return;

    setNoticeError('');

    try {
      const response = await fetch('/api/admin/notices/list', {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify(makeAdminAuthBody()),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '공지 이력을 불러오지 못했습니다.');
      }

      setNoticeHistory(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      console.error('[admin] notice history fetch failed:', error);
      setNoticeError(error.message || '공지 이력을 불러오지 못했습니다.');
    }
  }, [makeAdminAuthBody, makeAdminHeaders]);

  const fetchOperationLogs = useCallback(async (overrides = {}) => {
    const nextType = overrides.type || operationLogType;
    const nextPage = overrides.page || operationLogPage;
    const nextSort = overrides.sort || operationLogSort;
    const query = new URLSearchParams({
      type: nextType,
      page: String(nextPage),
      limit: '50',
      sort: nextSort,
    });

    setLoadingOperationLogs(true);
    setOperationLogError('');

    try {
      const response = await fetch(`/api/admin/operation-logs?${query.toString()}`, {
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '최근 적용 내역을 불러오지 못했습니다.');
      }

      setOperationLogs(Array.isArray(data.items) ? data.items : []);
      setOperationLogTotal(Number(data.total || 0));
      setOperationLogTotalPages(Math.max(Number(data.totalPages || 1), 1));
      setOperationLogPage(Number(data.page || nextPage));
      setOperationLogSort(data.sort || nextSort);
    } catch (error) {
      console.error('[admin] operation log fetch failed:', error);
      setOperationLogError(error.message || '최근 적용 내역을 불러오지 못했습니다.');
      setOperationLogs([]);
    } finally {
      setLoadingOperationLogs(false);
    }
  }, [makeAdminHeaders, operationLogPage, operationLogSort, operationLogType]);

  const fetchMaintenanceStatus = useCallback(async () => {
    setMaintenanceLoading(true);
    setMaintenanceError('');

    try {
      const response = await fetch('/api/maintenance/status');
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '점검 모드 상태를 불러오지 못했습니다.');
      }

      setMaintenanceForm({ ...DEFAULT_MAINTENANCE_FORM, ...(data.maintenance || {}) });
    } catch (error) {
      console.error('[admin] maintenance status fetch failed:', error);
      setMaintenanceError(error.message || '점검 모드 상태를 불러오지 못했습니다.');
    } finally {
      setMaintenanceLoading(false);
    }
  }, []);

  const handleMaintenanceSave = useCallback(async (nextEnabled) => {
    const trimmedMessage = maintenanceForm.message.trim() || DEFAULT_MAINTENANCE_FORM.message;

    setMaintenanceSaving(true);
    setMaintenanceError('');
    setMaintenanceSuccess('');

    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({
          ...makeAdminAuthBody(),
          enabled: nextEnabled,
          message: trimmedMessage,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '점검 모드 변경에 실패했습니다.');
      }

      setMaintenanceForm({ ...DEFAULT_MAINTENANCE_FORM, ...(data.maintenance || {}) });
      setMaintenanceSuccess(data.msg || '점검 모드가 변경되었습니다.');
      fetchOperationLogs({ type: 'maintenance', page: 1, sort: operationLogSort });
    } catch (error) {
      console.error('[admin] maintenance update failed:', error);
      setMaintenanceError(error.message || '점검 모드 변경에 실패했습니다.');
    } finally {
      setMaintenanceSaving(false);
    }
  }, [fetchOperationLogs, maintenanceForm.message, makeAdminAuthBody, makeAdminHeaders, operationLogSort]);

  const handleNoticeSubmit = useCallback(async (event) => {
    event.preventDefault();

    const trimmedMessage = noticeMessage.trim();
    const trimmedTitle = noticeTitle.trim();

    if (trimmedMessage.length < 2) {
      setNoticeSuccess('');
      setNoticeError('공지 내용은 최소 2글자 이상 입력해주세요.');
      return;
    }

    setSendingNotice(true);
    setNoticeError('');
    setNoticeSuccess('');

    try {
      const response = await fetch('/api/admin/notices/broadcast', {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({
          ...makeAdminAuthBody(),
          title: trimmedTitle || '관리자 공지',
          message: trimmedMessage,
          level: noticeLevel,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '전체 공지 발송에 실패했습니다.');
      }

      setNoticeMessage('');
      setNoticeTitle('');
      setNoticeHistory(Array.isArray(data.history) ? data.history : []);
      setNoticeSuccess(`전체 공지를 발송했습니다. 현재 접속 기준 ${data.deliveredTo || 0}명에게 표시됩니다.`);
      fetchOperationLogs({ type: 'notice', page: 1, sort: operationLogSort });
    } catch (error) {
      console.error('[admin] notice broadcast failed:', error);
      setNoticeError(error.message || '전체 공지 발송에 실패했습니다.');
    } finally {
      setSendingNotice(false);
    }
  }, [fetchOperationLogs, makeAdminAuthBody, makeAdminHeaders, noticeLevel, noticeMessage, noticeTitle, operationLogSort]);

  const handleOperationLogTypeToggle = useCallback(() => {
    const nextType = operationLogType === 'notice'? 'maintenance' : 'notice';
    setOperationLogType(nextType);
    setOperationLogPage(1);
    fetchOperationLogs({ type: nextType, page: 1, sort: operationLogSort });
  }, [fetchOperationLogs, operationLogSort, operationLogType]);

  const handleOperationLogSortToggle = useCallback(() => {
    const nextSort = operationLogSort === 'desc'? 'asc' : 'desc';
    setOperationLogSort(nextSort);
    setOperationLogPage(1);
    fetchOperationLogs({ type: operationLogType, page: 1, sort: nextSort });
  }, [fetchOperationLogs, operationLogSort, operationLogType]);

  const handleOperationLogPageMove = useCallback((nextPage) => {
    setOperationLogPage(nextPage);
    fetchOperationLogs({ type: operationLogType, page: nextPage, sort: operationLogSort });
  }, [fetchOperationLogs, operationLogSort, operationLogType]);

  return {
    noticeTitle,
    setNoticeTitle,
    noticeMessage,
    setNoticeMessage,
    noticeLevel,
    setNoticeLevel,
    noticeHistory,
    sendingNotice,
    noticeError,
    noticeSuccess,
    operationLogType,
    operationLogs,
    operationLogPage,
    operationLogTotalPages,
    operationLogTotal,
    operationLogSort,
    loadingOperationLogs,
    operationLogError,
    maintenanceForm,
    setMaintenanceForm,
    maintenanceLoading,
    maintenanceSaving,
    maintenanceError,
    maintenanceSuccess,
    fetchNoticeHistory,
    fetchOperationLogs,
    fetchMaintenanceStatus,
    handleMaintenanceSave,
    handleNoticeSubmit,
    handleOperationLogTypeToggle,
    handleOperationLogSortToggle,
    handleOperationLogPageMove,
  };
}
