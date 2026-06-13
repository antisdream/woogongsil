/* 결재 상세 모달의 인라인 스타일 우선 적용 보정입니다. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  API_BASE,
  DEFAULT_ADMIN_ERROR,
  RECENT_LOG_PAGE_SIZE,
  USER_PAGE_SIZE,
  ADMIN_TABS,
  ADMIN_TAB_ROUTE_MAP,
  getAdminTabFromPath,
  getStoredUser,
  getStoredUserId,
  getStoredUserName,
  getStoredServerInstanceId,
  getStoredSessionToken,
  normalizeApprovalStatus,
  getUserIdText,
  isPrimaryAdminRow,
  isPrimaryAdminUser,
  isOperatorRow,
  sortUsersByAdminRole,
  verifyAdminAccessWithServer,
} from '../features/admin/adminUtils.js';
import useAdminMealMap from '../features/admin/useAdminMealMap.js';
import useAdminScreenSettings from '../features/admin/useAdminScreenSettings.js';
import useAdminClassSchedules from '../features/admin/useAdminClassSchedules.js';
import useAdminQuestions from '../features/admin/useAdminQuestions.js';
import useAdminNoticeOperations from '../features/admin/useAdminNoticeOperations.js';
import useAdminApprovals from '../features/admin/useAdminApprovals.js';
import useAdminOnlineUsers from '../features/admin/useAdminOnlineUsers.js';
import AdminNoticeTab from '../features/admin/components/AdminNoticeTab.jsx';
import AdminPageHeader from '../features/admin/components/AdminPageHeader.jsx';
import AdminDashboardTab from '../features/admin/components/AdminDashboardTab.jsx';
import AdminMailModal from '../features/admin/components/AdminMailModal.jsx';
import AdminUsersTab from '../features/admin/components/AdminUsersTab.jsx';
import AdminApprovalsTab from '../features/admin/components/AdminApprovalsTab.jsx';
import AdminApprovalDetailModal from '../features/admin/components/AdminApprovalDetailModal.jsx';
import AdminQuestionsTab from '../features/admin/components/AdminQuestionsTab.jsx';
import AdminCalendarTab from '../features/admin/components/AdminCalendarTab.jsx';
import AdminDisplayTab from '../features/admin/components/AdminDisplayTab.jsx';
import AdminMealMapPlacesSection from '../features/admin/components/AdminMealMapPlacesSection.jsx';
import AdminMealMapEditRequestsSection from '../features/admin/components/AdminMealMapEditRequestsSection.jsx';
import AdminMealMapSettingsSection from '../features/admin/components/AdminMealMapSettingsSection.jsx';

// 관리자 회식맵 설정 API 호출 기본 경로입니다.
// 같은 도메인의 Express 서버 API를 사용하므로 빈 문자열을 기본값으로 둡니다.
function Admin() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminTabFromPath = getAdminTabFromPath(location.pathname);

  // 관리자 접근 가능 여부를 먼저 판단해 비관리자에게 화면이 순간적으로 보이는 현상을 막는다.
  const [canOpenAdmin, setCanOpenAdmin] = useState(false);
  const [checkedAdmin, setCheckedAdmin] = useState(false);

  //  사용자 관리 데이터 상태입니다.
  const [users, setUsers] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [summary, setSummary] = useState({ totalUsers: 0, activeUsers: 0, loggedInUsers: 0, todayLogs: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [userSort, setUserSort] = useState({ key: 'id', direction: 'asc' });
  const [userPage, setUserPage] = useState(1);
  // 사용자 관리 탭 안에서 회원 목록과 최근 접속 기록을 버튼으로 전환합니다.
  const [userPanelMode, setUserPanelMode] = useState('members');
  const [recentLogPage, setRecentLogPage] = useState(1); // 최근 접속 기록 탭 페이지 상태를 별도로 관리합니다.
  const [mailModal, setMailModal] = useState({ open: false, targetUser: null, subject: '', message: '', sending: false, error: '' });


  //  전체 공지 발송 데이터 상태입니다.
  // 제목/본문/중요도를 관리하고, 발송 이력은 서버 메모리에서 최근 항목만 받아온다.

  //  문제/해설 관리 상태입니다.
  // 문제 목록과 선택된 상세 폼을 분리해두면 목록 새로고침이 되어도 입력 중인 상세 폼이 갑자기 사라지지 않는다.
  // 홈 달력 일정 관리 상태입니다.

  // 현재 로그인한 사용자와 세션 토큰을 컴포넌트 내부에서 계속 재사용합니다.
  const currentUser = useMemo(() => getStoredUser(), []);
  // 초기 데이터 로딩은 검색어 입력이나 페이지 이동 때문에 useCallback 참조가 바뀌어도 한 번만 실행합니다.
  const didInitialAdminLoadRef = useRef(false);

  // 관리자 기능 영역을 탭으로 나누기 위한 현재 선택 탭 상태입니다.
  // 기존 기능을 삭제하거나 재작성하지 않고, 같은 컴포넌트 안에서 보이는 영역만 전환합니다.
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

  // 검색/정렬 기준이 바뀌면 빈 페이지에 남지 않도록 첫 페이지로 되돌린다.
  useEffect(() => {
    setUserPage(1);
  }, [appliedKeyword, userSort.key, userSort.direction]);

  // 페이지 진입 시 최고관리자 또는 운영자 권한 계정인지 1차 확인합니다.
  // 비로그인 또는 일반 계정이면 기존 홈으로 돌려보낸다.
  useEffect(() => {
    let cancelled = false;

    async function bootAdminPage() {
      const storedUser = getStoredUser();
      const verifiedUser = await verifyAdminAccessWithServer(storedUser);

      if (cancelled) return;

      if (!verifiedUser) {
        window.location.replace('/');
        return;
      }

      setCanOpenAdmin(true);
      setCheckedAdmin(true);
    }

    bootAdminPage();

return () => {
      cancelled = true;
    };
  }, []);

  // 관리자 전용 API에 공통으로 들어갈 인증 헤더를 생성합니다.
  const makeAdminHeaders = useCallback(() => {
    const user = getStoredUser();
    const token = getStoredSessionToken(user);

    return {
      'Content-Type': 'application/json',
      'x-user-id': getStoredUserId(user),
      'x-session-token': token,
    };
  }, []);

  const {
    mealMapPlaces,
    mealMapStats,
    mealMapStatusFilter,
    setMealMapStatusFilter,
    mealMapKeyword,
    setMealMapKeyword,
    mealMapLoading,
    mealMapSavingId,
    mealMapError,
    mealMapSuccess,
    mealMapEditRequests,
    mealMapEditStats,
    mealMapEditStatusFilter,
    setMealMapEditStatusFilter,
    mealMapEditKeyword,
    setMealMapEditKeyword,
    mealMapEditLoading,
    mealMapEditError,
    mealMapTextSettings,
    mealMapLayoutsV253,
    setMealMapLayoutsV253,
    mealMapTextLoading,
    mealMapTextSaving,
    loadMealMapLayoutsV253,
    saveMealMapLayoutSettingsV253,
    fetchMealMapAdminPlaces,
    runMealMapAdminAction,
    loadMealMapTextSettings,
    updateMealMapTextSetting,
    saveMealMapTextSettings,
    fetchMealMapEditRequests,
    runMealMapEditAction,
  } = useAdminMealMap({
    activeAdminTab,
    canOpenAdmin,
    makeAdminHeaders,
  });

  const makeAdminAuthBody = useCallback(() => {
    const user = getStoredUser();

    return {
      id: getStoredUserId(user),
      name: getStoredUserName(user),
      sessionToken: getStoredSessionToken(user),
      serverInstanceId: getStoredServerInstanceId(user),
    };
  }, []);

  const {
    onlineUsers,
    loadingOnline,
    onlineError,
    onlineFetchedAt,
    fetchOnlineUsers,
  } = useAdminOnlineUsers();

  // 회원 목록, 최근 로그인/로그아웃 기록, 회원 요약 통계를 불러온다.
  // 백엔드에서 관리자 세션을 한 번 더 검증하므로 일반 계정은 이 데이터를 받을 수 없습니다.
  const fetchAdminUsers = useCallback(
    async (keyword = appliedKeyword) => {
      setLoadingUsers(true);
      setAdminError('');

      try {
        const query = keyword ? `?search=${encodeURIComponent(keyword)}` : '';
        const response = await fetch(`/api/admin/users${query}`, {
          method: 'GET',
          headers: makeAdminHeaders(),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || data.msg || DEFAULT_ADMIN_ERROR);
        }

        setUsers(Array.isArray(data.users) ? data.users : []);
        setRecentLogs(Array.isArray(data.recentLogs) ? data.recentLogs : Array.isArray(data.recentLoginLogs) ? data.recentLoginLogs : []);

        const rawSummary = data.summary || {};
        setSummary({
          totalUsers: rawSummary.totalUsers || 0,
          activeUsers: rawSummary.activeUsers || 0,
          loggedInUsers: rawSummary.loggedInUsers || rawSummary.sessionKeepingUsers || 0,
          todayLogs: rawSummary.todayLogs || rawSummary.todayLoginCount || 0,
        });
      } catch (error) {
        console.error('[admin] users fetch failed:', error);
        setAdminError(error.message || DEFAULT_ADMIN_ERROR);
      } finally {
        setLoadingUsers(false);
      }
    },
    [appliedKeyword, makeAdminHeaders]
  );


  const refreshAdminUsers = useCallback(() => {
    fetchAdminUsers(appliedKeyword);
  }, [appliedKeyword, fetchAdminUsers]);

  const {
    adminApprovals,
    loadingApprovals,
    approvalError,
    approvalMeta,
    setApprovalPage,
    approvalDetailItem,
    setApprovalDetailItem,
    selectedApprovalIds,
    fetchAdminApprovals,
    handleApproveRequest,
    handleRejectRequest,
    sortedApprovals,
    approvalTotalPages,
    safeApprovalPage,
    pagedApprovals,
    selectableApprovalIdsOnPage,
    isAllApprovalsOnPageSelected,
    cycleApprovalStatusSort,
    cycleApprovalDirectionalSort,
    renderApprovalSortMark,
    isApprovalDeletable,
    toggleApprovalSelection,
    toggleAllApprovalSelection,
    handleDeleteSelectedApprovals,
  } = useAdminApprovals({
    canOpenAdmin,
    makeAdminHeaders,
    refreshUsers: refreshAdminUsers,
  });

  // 관리자 공지 발송 이력을 불러온다.
  // DB를 새로 만들지 않고 서버 메모리에 저장된 최근 공지 목록만 확인합니다.
  const {
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
  } = useAdminNoticeOperations({
    makeAdminAuthBody,
    makeAdminHeaders,
  });

  const {
    questionMeta,
    questionType,
    questionSearch,
    setQuestionSearch,
    questionFilters,
    setQuestionFilters,
    questionPage,
    questionRows,
    questionTotal,
    totalQuestionPages,
    selectedQuestion,
    questionForm,
    loadingQuestions,
    loadingQuestionDetail,
    savingQuestion,
    questionError,
    questionSuccess,
    fetchQuestionMeta,
    fetchAdminQuestions,
    fetchQuestionDetail,
    handleQuestionSearchSubmit,
    handleQuestionTypeChange,
    handleQuestionFilterReset,
    handleQuestionPageMove,
    handleQuestionFormChange,
    handleQuestionSave,
  } = useAdminQuestions({
    makeAdminHeaders,
  });

  const {
    classSchedules,
    classScheduleSummary,
    classScheduleFilters,
    classScheduleForm,
    editingClassScheduleId,
    loadingClassSchedules,
    savingClassSchedule,
    classScheduleError,
    classScheduleSuccess,
    fetchClassSchedules,
    resetClassScheduleForm,
    handleClassScheduleFormChange,
    handleClassScheduleSubmit,
    startEditClassSchedule,
    handleToggleClassSchedule,
    handleDeleteClassSchedule,
    handleClassScheduleFilterChange,
    handleClassScheduleFilterSubmit,
  } = useAdminClassSchedules({
    activeAdminTab,
    makeAdminHeaders,
  });

  const {
    screenSettings,
    screenSummary,
    screenFilters,
    screenForm,
    editingScreenSettingId,
    loadingScreenSettings,
    savingScreenSetting,
    screenError,
    screenSuccess,
    fetchScreenSettings,
    handleScreenFormChange,
    resetScreenForm,
    startEditScreenSetting,
    handleScreenSettingSubmit,
    handleBulkScreenSettingSave,
    handleToggleScreenSetting,
    handleDeleteScreenSetting,
    handleScreenFilterChange,
    handleScreenFilterSubmit,
  } = useAdminScreenSettings({
    currentUser,
    makeAdminHeaders,
  });

  // 관리자 화면이 열린 뒤 ~데이터를 한 번에 불러온다.
  useEffect(() => {
    if (!canOpenAdmin || didInitialAdminLoadRef.current) return;

    didInitialAdminLoadRef.current = true;
    fetchAdminUsers('');
    fetchOnlineUsers();
    fetchNoticeHistory();
    fetchOperationLogs({ page: 1 });
    fetchMaintenanceStatus();
    fetchQuestionMeta();
    fetchAdminQuestions({ page: 1 });
    fetchScreenSettings();
  }, [canOpenAdmin, fetchAdminUsers, fetchOnlineUsers, fetchNoticeHistory, fetchOperationLogs, fetchMaintenanceStatus, fetchQuestionMeta, fetchAdminQuestions, fetchScreenSettings]);

  // 대시보드/문제 관리 탭을 열 때 DB 기준 문제 수를 다시 조회합니다.
  // 관리자 화면을 켜 둔 상태에서 문제 CSV나 SQL을 추가하면 상단 관리 문제 수가 예전 값으로 보일 수 있어서 보강합니다.
  useEffect(() => {
    if (!canOpenAdmin) return;
    if (activeAdminTab === 'dashboard' || activeAdminTab === 'questions') {
      fetchQuestionMeta();
    }
  }, [activeAdminTab, canOpenAdmin, fetchQuestionMeta]);

  //  실시간 접속자 목록은 10초마다 자동 갱신합니다.
  // 사용자가 새로고침 버튼을 누르지 않아도 관리자 화면에서 접속 상태 흐름을 볼 수 있습니다.
  useEffect(() => {
    if (!canOpenAdmin) return undefined;

    const timer = window.setInterval(() => {
      fetchOnlineUsers();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [canOpenAdmin, fetchOnlineUsers]);

  // 검색 버튼을 눌렀을 때만 검색어를 확정해 API를 호출합니다.
  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const nextKeyword = searchKeyword.trim();

    setAppliedKeyword(nextKeyword);
    fetchAdminUsers(nextKeyword);
  };

  // 전체보기 버튼은 검색어를 비우고 전체 회원 목록을 다시 조회합니다.
  const handleResetSearch = () => {
    setSearchKeyword('');
    setAppliedKeyword('');
    fetchAdminUsers('');
  };

  const refreshUserAndApprovals = () => {
    refreshAdminUsers();
    fetchAdminApprovals();
  };

  const handleAdminActionResult = (data, fallbackMessage) => {
    // 운영자는 실제 DB 반영 대신 결재 요청이 생성됩니다.
    // 사용자 목록은 유지하고 결재 목록을 함께 새로고침해 요청 상태를 바로 확인할 수 있도록 합니다.
    if (data?.pendingApproval) {
      alert(data.message || '결재 요청이 등록되었습니다. 최고관리자 승인 후 실제 반영됩니다.');
      openAdminTab('approvals');
      refreshUserAndApprovals();
      return;
    }

    alert(data?.message || fallbackMessage);
    refreshUserAndApprovals();
  };


  const handleSuspendUser = async (targetUser) => {
    if (!targetUser || isUserActionProtectedRow(targetUser)) return;
    const shouldSuspend = !targetUser.isSuspended;
    let reason = '';

    if (shouldSuspend) {
      reason = window.prompt(`${targetUser.name || targetUser.id} 사용자를 임시정지하는 사유를 입력해 주세요.`) || '';
      if (!reason.trim()) return;
    } else {
      const confirmed = window.confirm(`${targetUser.name || targetUser.id} 사용자의 임시정지를 해제하시겠습니까?`);
      if (!confirmed) return;
    }

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.id)}/suspend`, {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ suspend: shouldSuspend, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '임시정지 처리에 실패했습니다.');
      handleAdminActionResult(data, '처리되었습니다.');
    } catch (error) {
      alert(error.message || '임시정지 처리에 실패했습니다.');
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!targetUser || isUserActionProtectedRow(targetUser)) return;
    const first = window.confirm(`${targetUser.name || targetUser.id} 계정을 삭제하시겠습니까? 삭제 후에는 복구할 수 없으며, 사용자는 다시 회원가입할 수 있습니다.`);
    if (!first) return;
    const second = window.confirm('정말 삭제하시겠습니까? 사용자 DB 기록도 함께 정리됩니다.');
    if (!second) return;

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.id)}`, {
        method: 'DELETE',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '계정 삭제에 실패했습니다.');
      handleAdminActionResult(data, '삭제되었습니다.');
    } catch (error) {
      alert(error.message || '계정 삭제에 실패했습니다.');
    }
  };

  const handleToggleOperator = async (targetUser) => {
    if (!targetUser || isUserActionProtectedRow(targetUser)) return;
    const enable = !targetUser.isOperator;
    let reason = '';

    if (enable) {
      const confirmed = window.confirm(`정말로 ${targetUser.name || targetUser.id}에게 운영자 권한을 활성화 하시겠습니까?`);
      if (!confirmed) return;
    } else {
      reason = window.prompt(`${targetUser.name || targetUser.id} 운영자 권한을 비활성화하는 사유를 입력해 주세요.`) || '';
      if (!reason.trim()) return;
      const confirmed = window.confirm('운영자 권한을 비활성화하시겠습니까?');
      if (!confirmed) return;
    }

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.id)}/operator`, {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ enable, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '운영자 권한 처리에 실패했습니다.');
      handleAdminActionResult(data, '처리되었습니다.');
    } catch (error) {
      alert(error.message || '운영자 권한 처리에 실패했습니다.');
    }
  };

  const openUserEmailModal = (targetUser) => {
    if (!targetUser?.email) return;
    setMailModal({ open: true, targetUser, subject: '', message: '', sending: false, error: '' });
  };

  const closeUserEmailModal = () => {
    if (mailModal.sending) return;
    setMailModal({ open: false, targetUser: null, subject: '', message: '', sending: false, error: '' });
  };

  const handleSendUserEmail = async (event) => {
    event.preventDefault();
    const targetUser = mailModal.targetUser;
    if (!targetUser?.email) return;

    const subject = mailModal.subject.trim();
    const message = mailModal.message.trim();

    if (!subject) {
      setMailModal((prev) => ({ ...prev, error: '이메일 제목을 입력해 주세요.' }));
      return;
    }
    if (!message) {
      setMailModal((prev) => ({ ...prev, error: '이메일 내용을 입력해 주세요.' }));
      return;
    }

    setMailModal((prev) => ({ ...prev, sending: true, error: '' }));
    try {
      const response = await fetch('/api/admin/email-user', {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ userId: targetUser.id, subject, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '이메일 전송에 실패했습니다.');
      alert(data.message || '이메일을 전송했습니다.');
      setMailModal({ open: false, targetUser: null, subject: '', message: '', sending: false, error: '' });
    } catch (error) {
      setMailModal((prev) => ({ ...prev, sending: false, error: error.message || '이메일 전송에 실패했습니다.' }));
    }
  };

  const handleOpenUserRanking = (targetUser) => {
    if (!targetUser?.id) return;
    window.open(`/admin/user-ranking/${encodeURIComponent(targetUser.id)}`, '_blank', 'noopener,noreferrer,width=1280,height=900');
  };

  //  필터 입력 영역을 문제 타입에 따라 다르게 렌더링합니다.


  //  선택된 문제의 상세 수정 폼입니다.
  // 필기와 실기의 DB 컬럼이 다르므로 필요한 입력 칸을 분기해서 보여줍니다.


  const viewerId = getStoredUserId(currentUser);
  const isPrimaryAdminViewer = isPrimaryAdminUser(currentUser);
  const isSelfUserRow = (item) => viewerId && getUserIdText(item) === viewerId;
  const isUserActionProtectedRow = (item) => {
    if (!item) return true;
    if (isPrimaryAdminViewer) return isPrimaryAdminRow(item);
    return isPrimaryAdminRow(item) || isOperatorRow(item) || isSelfUserRow(item);
  };

  const handleUserSort = (key) => {
    setUserSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc'? 'desc' : 'asc',
    }));
  };

  const sortedUserGroups = useMemo(() => sortUsersByAdminRole(users, userSort), [users, userSort]);

  const userTotalPages = Math.max(1, Math.ceil(sortedUserGroups.normalUsers.length / USER_PAGE_SIZE));
  const safeUserPage = Math.min(userPage, userTotalPages);
  const displayedUsers = useMemo(() => {
    const startIndex = (safeUserPage - 1) * USER_PAGE_SIZE;
    const pagedNormalUsers = sortedUserGroups.normalUsers.slice(startIndex, startIndex + USER_PAGE_SIZE);
    return [...sortedUserGroups.primaryAdmins, ...sortedUserGroups.operators, ...pagedNormalUsers];
  }, [safeUserPage, sortedUserGroups]);

  function handleUserPanelToggle() {
    // 사용자 관리/최근 접속 기록 전환 시 최근 접속 기록은 항상 첫 페이지부터 보여줍니다.
    setRecentLogPage(1);
    setUserPanelMode((prevMode) => (prevMode === 'members'? 'recent' : 'members'));
  }

  // 최근 접속 기록 탭 전환 시 필요한 페이지 계산값을 명시하여 버튼 클릭 후 렌더링 오류를 방지합니다.
  const recentLogTotalPages = Math.max(1, Math.ceil((recentLogs?.length || 0) / RECENT_LOG_PAGE_SIZE));
  const safeRecentLogPage = Math.min(recentLogPage, recentLogTotalPages);
  const displayedRecentLogs = (recentLogs || []).slice(
    (safeRecentLogPage - 1) * RECENT_LOG_PAGE_SIZE,
    safeRecentLogPage * RECENT_LOG_PAGE_SIZE
  );

  // 접속자 목록에서 관리자 본인을 구분해 보여주기 위한 값입니다.
  const adminId = getStoredUserId(currentUser);

  // 검색 결과 개수와 현재 접속자 수를 계산해 상단 카드에 보여줍니다.
  const adminStats = useMemo(
    () => [
      {
        label: '전체 회원',
        value: `${summary.totalUsers || users.length}명`,
        desc: '등록된 회원 기준',
      },
      {
        label: '현재 접속',
        value: `${onlineUsers.length}명`,
        desc: '실시간 접속 유지 사용자',
      },
      {
        label: '공지 이력',
        value: `${noticeHistory.length}건`,
        desc: '서버에 보관 중인 최근 공지',
      },
      {
        label: '결재 사항',
        value: `${adminApprovals.filter((approval) => normalizeApprovalStatus(approval.status) === 'PENDING').length}건`,
        desc: '승인 대기 중인 운영자 요청',
      },
      {
        label: '관리 문제',
        value: `${Number(questionMeta.summary?.written || 0) + Number(questionMeta.summary?.ipepRandom || 0) + Number(questionMeta.summary?.ipepPast || 0)}개`,
        desc: '필기·실기 문제 전체',
      },
    ],
    [adminApprovals, noticeHistory.length, onlineUsers.length, questionMeta.summary, summary.totalUsers, users.length]
  );


  // 비관리자 이동 처리 중에는 빈 화면을 보여줍니다.
  // 관리자 인증 확인 중/실패 상태를 빈 화면 대신 표시합니다.
  if (!checkedAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page-bg, #eef5ff)', color: 'var(--text-main, #111827)' }}>
        <div style={{ padding: '28px 32px', borderRadius: 20, background: 'var(--card-bg, #fff)', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)', fontWeight: 800 }}>
          관리자 페이지를 확인하는 중입니다.
        </div>
      </div>
    );
  }

  if (!canOpenAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page-bg, #eef5ff)', color: 'var(--text-main, #111827)' }}>
        <div style={{ maxWidth: 620, padding: '28px 32px', borderRadius: 20, background: 'var(--card-bg, #fff)', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 24 }}>관리자 권한을 확인할 수 없습니다.</h2>
          <p style={{ margin: 0, lineHeight: 1.7, color: 'var(--text-sub, #64748b)', fontWeight: 700 }}>
            서버 재시작 후 세션이 만료되었거나 관리자 권한 확인 요청이 실패했습니다. 로그아웃 후 관리자 계정으로 다시 로그인해 주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page admin-page-tabbed">
      {/* 관리자 페이지 상단 요약 영역 */}
      <AdminPageHeader
        maintenanceForm={maintenanceForm}
        adminStats={adminStats}
        activeAdminTab={activeAdminTab}
        openAdminTab={openAdminTab}
      />

      {/* 대시보드 탭: 운영자가 자주 확인하는 핵심 상태를 한 화면에 요약합니다. */}
      {activeAdminTab === 'dashboard' && (
        <AdminDashboardTab
          openAdminTab={openAdminTab}
          summary={summary}
          users={users}
          onlineUsers={onlineUsers}
          adminApprovals={adminApprovals}
          noticeHistory={noticeHistory}
          maintenanceForm={maintenanceForm}
          questionMeta={questionMeta}
          mealMapStats={mealMapStats}
        />
      )}

      {/* 사용자·접속 관리 탭 */}
      {activeAdminTab === 'users' && (
        <AdminUsersTab
          onlineFetchedAt={onlineFetchedAt}
          fetchOnlineUsers={fetchOnlineUsers}
          loadingOnline={loadingOnline}
          onlineError={onlineError}
          onlineUsers={onlineUsers}
          adminId={adminId}
          userPanelMode={userPanelMode}
          handleSearchSubmit={handleSearchSubmit}
          searchKeyword={searchKeyword}
          setSearchKeyword={setSearchKeyword}
          handleResetSearch={handleResetSearch}
          adminError={adminError}
          summary={summary}
          users={users}
          loadingUsers={loadingUsers}
          fetchAdminUsers={fetchAdminUsers}
          appliedKeyword={appliedKeyword}
          handleUserPanelToggle={handleUserPanelToggle}
          displayedUsers={displayedUsers}
          userSort={userSort}
          handleUserSort={handleUserSort}
          openUserEmailModal={openUserEmailModal}
          isUserActionProtectedRow={isUserActionProtectedRow}
          handleOpenUserRanking={handleOpenUserRanking}
          handleSuspendUser={handleSuspendUser}
          handleDeleteUser={handleDeleteUser}
          handleToggleOperator={handleToggleOperator}
          safeUserPage={safeUserPage}
          userTotalPages={userTotalPages}
          setUserPage={setUserPage}
          displayedRecentLogs={displayedRecentLogs}
          safeRecentLogPage={safeRecentLogPage}
          recentLogTotalPages={recentLogTotalPages}
          setRecentLogPage={setRecentLogPage}
        />
      )}

      {activeAdminTab === 'approvals' && (
        <AdminApprovalsTab
          approvalMeta={approvalMeta}
          sortedApprovals={sortedApprovals}
          safeApprovalPage={safeApprovalPage}
          approvalTotalPages={approvalTotalPages}
          selectedApprovalIds={selectedApprovalIds}
          handleDeleteSelectedApprovals={handleDeleteSelectedApprovals}
          loadingApprovals={loadingApprovals}
          selectableApprovalIdsOnPage={selectableApprovalIdsOnPage}
          isAllApprovalsOnPageSelected={isAllApprovalsOnPageSelected}
          toggleAllApprovalSelection={toggleAllApprovalSelection}
          fetchAdminApprovals={fetchAdminApprovals}
          approvalError={approvalError}
          pagedApprovals={pagedApprovals}
          isApprovalDeletable={isApprovalDeletable}
          toggleApprovalSelection={toggleApprovalSelection}
          renderApprovalSortMark={renderApprovalSortMark}
          cycleApprovalStatusSort={cycleApprovalStatusSort}
          cycleApprovalDirectionalSort={cycleApprovalDirectionalSort}
          setApprovalDetailItem={setApprovalDetailItem}
          handleApproveRequest={handleApproveRequest}
          handleRejectRequest={handleRejectRequest}
          setApprovalPage={setApprovalPage}
        />
      )}

      {activeAdminTab === 'notice' && (
        <AdminNoticeTab
          fetchOperationLogs={fetchOperationLogs}
          operationLogType={operationLogType}
          operationLogPage={operationLogPage}
          operationLogSort={operationLogSort}
          noticeError={noticeError}
          noticeSuccess={noticeSuccess}
          handleNoticeSubmit={handleNoticeSubmit}
          noticeTitle={noticeTitle}
          setNoticeTitle={setNoticeTitle}
          noticeLevel={noticeLevel}
          setNoticeLevel={setNoticeLevel}
          noticeMessage={noticeMessage}
          setNoticeMessage={setNoticeMessage}
          sendingNotice={sendingNotice}
          maintenanceError={maintenanceError}
          maintenanceSuccess={maintenanceSuccess}
          maintenanceForm={maintenanceForm}
          setMaintenanceForm={setMaintenanceForm}
          fetchMaintenanceStatus={fetchMaintenanceStatus}
          maintenanceLoading={maintenanceLoading}
          maintenanceSaving={maintenanceSaving}
          handleMaintenanceSave={handleMaintenanceSave}
          handleOperationLogTypeToggle={handleOperationLogTypeToggle}
          handleOperationLogSortToggle={handleOperationLogSortToggle}
          operationLogError={operationLogError}
          operationLogTotal={operationLogTotal}
          loadingOperationLogs={loadingOperationLogs}
          operationLogs={operationLogs}
          operationLogTotalPages={operationLogTotalPages}
          handleOperationLogPageMove={handleOperationLogPageMove}
        />
      )}

      {/* 문제 관리 탭 */}
      {activeAdminTab === 'questions' && (
        <AdminQuestionsTab
          questionError={questionError}
          questionSuccess={questionSuccess}
          fetchQuestionMeta={fetchQuestionMeta}
          fetchAdminQuestions={fetchAdminQuestions}
          questionPage={questionPage}
          questionMeta={questionMeta}
          questionTotal={questionTotal}
          totalQuestionPages={totalQuestionPages}
          handleQuestionSearchSubmit={handleQuestionSearchSubmit}
          questionType={questionType}
          handleQuestionTypeChange={handleQuestionTypeChange}
          questionSearch={questionSearch}
          setQuestionSearch={setQuestionSearch}
          questionFilters={questionFilters}
          setQuestionFilters={setQuestionFilters}
          handleQuestionFilterReset={handleQuestionFilterReset}
          questionRows={questionRows}
          loadingQuestions={loadingQuestions}
          selectedQuestion={selectedQuestion}
          loadingQuestionDetail={loadingQuestionDetail}
          fetchQuestionDetail={fetchQuestionDetail}
          handleQuestionPageMove={handleQuestionPageMove}
          questionForm={questionForm}
          savingQuestion={savingQuestion}
          handleQuestionSave={handleQuestionSave}
          handleQuestionFormChange={handleQuestionFormChange}
        />
      )}

      {activeAdminTab === 'calendar' && (
        <AdminCalendarTab
          fetchClassSchedules={fetchClassSchedules}
          loadingClassSchedules={loadingClassSchedules}
          classScheduleSummary={classScheduleSummary}
          classSchedules={classSchedules}
          classScheduleError={classScheduleError}
          classScheduleSuccess={classScheduleSuccess}
          handleClassScheduleSubmit={handleClassScheduleSubmit}
          editingClassScheduleId={editingClassScheduleId}
          resetClassScheduleForm={resetClassScheduleForm}
          classScheduleForm={classScheduleForm}
          handleClassScheduleFormChange={handleClassScheduleFormChange}
          savingClassSchedule={savingClassSchedule}
          classScheduleFilters={classScheduleFilters}
          handleClassScheduleFilterSubmit={handleClassScheduleFilterSubmit}
          handleClassScheduleFilterChange={handleClassScheduleFilterChange}
          startEditClassSchedule={startEditClassSchedule}
          handleToggleClassSchedule={handleToggleClassSchedule}
          handleDeleteClassSchedule={handleDeleteClassSchedule}
        />
      )}

      {/* 화면 설정 탭 */}
      {activeAdminTab === 'display' && (
        <AdminDisplayTab
          fetchScreenSettings={fetchScreenSettings}
          loadingScreenSettings={loadingScreenSettings}
          screenSummary={screenSummary}
          screenError={screenError}
          screenSuccess={screenSuccess}
          handleScreenSettingSubmit={handleScreenSettingSubmit}
          editingScreenSettingId={editingScreenSettingId}
          resetScreenForm={resetScreenForm}
          screenForm={screenForm}
          handleScreenFormChange={handleScreenFormChange}
          handleBulkScreenSettingSave={handleBulkScreenSettingSave}
          savingScreenSetting={savingScreenSetting}
          screenFilters={screenFilters}
          handleScreenFilterSubmit={handleScreenFilterSubmit}
          handleScreenFilterChange={handleScreenFilterChange}
          screenSettings={screenSettings}
          startEditScreenSetting={startEditScreenSetting}
          handleToggleScreenSetting={handleToggleScreenSetting}
          handleDeleteScreenSetting={handleDeleteScreenSetting}
        />
      )}


      {/* 회식맵 관리자 승인/반려 관리 탭 */}
      {activeAdminTab === 'mealmap' && (
        <AdminMealMapPlacesSection
          fetchMealMapAdminPlaces={fetchMealMapAdminPlaces}
          mealMapLoading={mealMapLoading}
          mealMapStats={mealMapStats}
          mealMapStatusFilter={mealMapStatusFilter}
          setMealMapStatusFilter={setMealMapStatusFilter}
          mealMapKeyword={mealMapKeyword}
          setMealMapKeyword={setMealMapKeyword}
          mealMapError={mealMapError}
          mealMapSuccess={mealMapSuccess}
          mealMapPlaces={mealMapPlaces}
          mealMapSavingId={mealMapSavingId}
          runMealMapAdminAction={runMealMapAdminAction}
        />
      )}

      <AdminMailModal
        mailModal={mailModal}
        closeUserEmailModal={closeUserEmailModal}
        handleSendUserEmail={handleSendUserEmail}
        setMailModal={setMailModal}
      />


      <AdminApprovalDetailModal
        approvalDetailItem={approvalDetailItem}
        setApprovalDetailItem={setApprovalDetailItem}
      />

      {activeAdminTab === 'mealmap' && (
        <AdminMealMapEditRequestsSection
          fetchMealMapEditRequests={fetchMealMapEditRequests}
          mealMapEditLoading={mealMapEditLoading}
          mealMapEditStats={mealMapEditStats}
          mealMapEditStatusFilter={mealMapEditStatusFilter}
          setMealMapEditStatusFilter={setMealMapEditStatusFilter}
          mealMapEditKeyword={mealMapEditKeyword}
          setMealMapEditKeyword={setMealMapEditKeyword}
          mealMapEditError={mealMapEditError}
          mealMapEditRequests={mealMapEditRequests}
          runMealMapEditAction={runMealMapEditAction}
        />
      )}



      {activeAdminTab === 'mealmap' && (
        <AdminMealMapSettingsSection
          loadMealMapLayoutsV253={loadMealMapLayoutsV253}
          saveMealMapLayoutSettingsV253={saveMealMapLayoutSettingsV253}
          mealMapLayoutsV253={mealMapLayoutsV253}
          setMealMapLayoutsV253={setMealMapLayoutsV253}
          loadMealMapTextSettings={loadMealMapTextSettings}
          saveMealMapTextSettings={saveMealMapTextSettings}
          mealMapTextLoading={mealMapTextLoading}
          mealMapTextSaving={mealMapTextSaving}
          mealMapTextSettings={mealMapTextSettings}
          updateMealMapTextSetting={updateMealMapTextSetting}
        />
      )}

    </div>
  );
}

export default Admin;
