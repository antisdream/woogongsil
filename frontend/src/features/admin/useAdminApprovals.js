// 관리자 기능 모듈입니다: useAdminApprovals
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APPROVAL_PAGE_SIZE,
  APPROVAL_STATUS_SORT_LABELS,
  APPROVAL_STATUS_SORT_MODES,
  getStoredUser,
  isPrimaryAdminUser,
  normalizeApprovalStatus,
  sortApprovalList,
} from './adminUtils.js';

export default function useAdminApprovals({ canOpenAdmin, makeAdminHeaders, refreshUsers }) {
  const [adminApprovals, setAdminApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  // ADMIN_USER_ID 미정의 참조로 관리자 페이지가 빈 화면이 되는 문제 방지
  const [approvalMeta, setApprovalMeta] = useState({ isPrimaryAdmin: isPrimaryAdminUser(getStoredUser()) });
  const [approvalPage, setApprovalPage] = useState(1); // 결재 사항 페이지네이션 현재 페이지
  // 결재 상세 보기 팝업 전용 상태입니다. 승인/반려 처리 로직과 분리합니다.
  const [approvalDetailItem, setApprovalDetailItem] = useState(null);
  const [approvalSort, setApprovalSort] = useState({ field: 'default', direction: 'default', mode: 'default' }); // 결재 사항 정렬 상태
  const [selectedApprovalIds, setSelectedApprovalIds] = useState([]); // 결재 사항 체크박스 선택 ID 목록

  const fetchAdminApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    setApprovalError('');

    try {
      const response = await fetch('/api/admin/approvals', {
        method: 'GET',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.message || '결재 목록을 불러오지 못했습니다.');
      }

      setApprovalMeta({ isPrimaryAdmin: Boolean(data.isPrimaryAdmin) });
      setAdminApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setApprovalPage(1); // 새로고침 후 빈 페이지가 보이지 않도록 첫 페이지로 이동합니다.
      setSelectedApprovalIds([]); // 이전 목록의 선택 상태가 새 목록에 섞이지 않도록 초기화합니다.
    } catch (error) {
      console.error('[admin] approvals fetch failed:', error);
      setApprovalError(error.message || '결재 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingApprovals(false);
    }
  }, [makeAdminHeaders]);

  useEffect(() => {
    if (!canOpenAdmin) return;
    fetchAdminApprovals();
  }, [canOpenAdmin, fetchAdminApprovals]);

  const refreshUserAndApprovals = useCallback(() => {
    if (typeof refreshUsers === 'function') {
      refreshUsers();
    }
    fetchAdminApprovals();
  }, [fetchAdminApprovals, refreshUsers]);

  const handleApproveRequest = async (approvalId) => {
    const confirmed = window.confirm('이 결재 요청을 승인하고 실제 데이터에 반영하시겠습니까?');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/admin/approvals/${approvalId}/approve`, {
        method: 'POST',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '승인 처리에 실패했습니다.');
      alert(data.message || '승인되었습니다.');
      refreshUserAndApprovals();
    } catch (error) {
      alert(error.message || '승인 처리에 실패했습니다.');
    }
  };

  const handleRejectRequest = async (approvalId) => {
    const reason = window.prompt('반려 사유를 입력해 주세요.') || '';
    if (!reason.trim()) return;

    try {
      const response = await fetch(`/api/admin/approvals/${approvalId}/reject`, {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '반려 처리에 실패했습니다.');
      alert(data.message || '반려되었습니다.');
      fetchAdminApprovals();
    } catch (error) {
      alert(error.message || '반려 처리에 실패했습니다.');
    }
  };

  const sortedApprovals = useMemo(() => sortApprovalList(adminApprovals, approvalSort), [adminApprovals, approvalSort]);
  const approvalTotalPages = Math.max(1, Math.ceil(sortedApprovals.length / APPROVAL_PAGE_SIZE));
  const safeApprovalPage = Math.min(Math.max(approvalPage, 1), approvalTotalPages);
  const pagedApprovals = sortedApprovals.slice((safeApprovalPage - 1) * APPROVAL_PAGE_SIZE, safeApprovalPage * APPROVAL_PAGE_SIZE);
  const selectableApprovalIdsOnPage = pagedApprovals
    .filter((approval) => normalizeApprovalStatus(approval.status) !== 'PENDING')
    .map((approval) => Number(approval.id));
  const selectedApprovalIdsOnPage = selectedApprovalIds.filter((id) => selectableApprovalIdsOnPage.includes(Number(id)));
  const isAllApprovalsOnPageSelected = selectableApprovalIdsOnPage.length >0 && selectedApprovalIdsOnPage.length === selectableApprovalIdsOnPage.length;

  const cycleApprovalStatusSort = () => {
    // 상태 정렬 버튼은 승인, 반려, 대기, 기본 순서로 순환합니다.
    setApprovalSort((current) => {
      const currentMode = current.field === 'status'? current.mode || 'default' : 'default';
      const currentIndex = APPROVAL_STATUS_SORT_MODES.indexOf(currentMode);
      const nextMode = APPROVAL_STATUS_SORT_MODES[(currentIndex + 1) % APPROVAL_STATUS_SORT_MODES.length];
      return nextMode === 'default'? { field: 'default', direction: 'default', mode: 'default' }
        : { field: 'status', direction: 'asc', mode: nextMode };
    });
    setApprovalPage(1);
  };

  const cycleApprovalDirectionalSort = (field) => {
    // 요청자/날짜 정렬은 오름차순, 내림차순, 기본 순서로 순환합니다.
    setApprovalSort((current) => {
      if (current.field !== field) return { field, direction: 'asc', mode: 'default' };
      if (current.direction === 'asc') return { field, direction: 'desc', mode: 'default' };
      return { field: 'default', direction: 'default', mode: 'default' };
    });
    setApprovalPage(1);
  };

  const renderApprovalSortMark = (field) => {
    if (field === 'status') {
      return approvalSort.field === 'status'? APPROVAL_STATUS_SORT_LABELS[approvalSort.mode] || '기본' : '정렬';
    }
    if (approvalSort.field !== field) return '정렬';
    return approvalSort.direction === 'asc'? '오름차순' : approvalSort.direction === 'desc'? '내림차순' : '정렬';
  };

  const isApprovalDeletable = (approval) => normalizeApprovalStatus(approval?.status) !== 'PENDING';

  const toggleApprovalSelection = (approval) => {
    if (!isApprovalDeletable(approval)) return;
    const id = Number(approval.id);
    setSelectedApprovalIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAllApprovalSelection = () => {
    const selectableSet = new Set(selectableApprovalIdsOnPage);
    if (selectableApprovalIdsOnPage.length >0 && selectedApprovalIdsOnPage.length === selectableApprovalIdsOnPage.length) {
      setSelectedApprovalIds((prev) => prev.filter((id) => !selectableSet.has(Number(id))));
      return;
    }
    setSelectedApprovalIds((prev) => [...new Set([...prev, ...selectableApprovalIdsOnPage])]);
  };

  const handleDeleteSelectedApprovals = async () => {
    if (selectedApprovalIds.length === 0) return;
    const selectedRows = adminApprovals.filter((approval) => selectedApprovalIds.includes(Number(approval.id)));
    if (selectedRows.some((approval) => !isApprovalDeletable(approval))) {
      alert('대기 상태 결재는 승인 또는 반려 후 정리할 수 있습니다.');
      return;
    }
    if (!window.confirm(`선택한 결재 내역 ${selectedApprovalIds.length}개를 현재 계정 화면에서 정리하시겠습니까?`)) return;

    try {
      setLoadingApprovals(true);
      setApprovalError('');
      const response = await fetch('/api/admin/approvals', {
        method: 'DELETE',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ ids: selectedApprovalIds }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.message || '결재 내역 정리에 실패했습니다.');
      alert(data.message || '선택한 결재 내역을 정리했습니다.');
      fetchAdminApprovals();
    } catch (error) {
      setApprovalError(error.message || '결재 내역 정리에 실패했습니다.');
      alert(error.message || '결재 내역 정리에 실패했습니다.');
    } finally {
      setLoadingApprovals(false);
    }
  };


  return {
    adminApprovals,
    loadingApprovals,
    approvalError,
    approvalMeta,
    approvalPage,
    setApprovalPage,
    approvalDetailItem,
    setApprovalDetailItem,
    approvalSort,
    selectedApprovalIds,
    fetchAdminApprovals,
    handleApproveRequest,
    handleRejectRequest,
    sortedApprovals,
    approvalTotalPages,
    safeApprovalPage,
    pagedApprovals,
    selectableApprovalIdsOnPage,
    selectedApprovalIdsOnPage,
    isAllApprovalsOnPageSelected,
    cycleApprovalStatusSort,
    cycleApprovalDirectionalSort,
    renderApprovalSortMark,
    isApprovalDeletable,
    toggleApprovalSelection,
    toggleAllApprovalSelection,
    handleDeleteSelectedApprovals,
  };
}
