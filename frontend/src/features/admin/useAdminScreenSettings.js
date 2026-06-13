// 관리자 기능 모듈입니다: useAdminScreenSettings
import { useCallback, useState } from 'react';
import { EMPTY_SCREEN_SETTING_FORM } from './adminUtils.js';

export default function useAdminScreenSettings({
  currentUser,
  makeAdminHeaders,
}) {
  const [screenSettings, setScreenSettings] = useState([]);
  const [screenSummary, setScreenSummary] = useState({});
  const [screenFilters, setScreenFilters] = useState({ page_key: 'home', setting_type: '', keyword: '', activeOnly: true });
  const [screenForm, setScreenForm] = useState(EMPTY_SCREEN_SETTING_FORM);
  const [editingScreenSettingId, setEditingScreenSettingId] = useState(null);
  const [loadingScreenSettings, setLoadingScreenSettings] = useState(false);
  const [savingScreenSetting, setSavingScreenSetting] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [screenSuccess, setScreenSuccess] = useState('');

  const fetchScreenSettings = useCallback(async (overrides = {}) => {
    const nextFilters = { ...screenFilters, ...overrides };
    const params = new URLSearchParams();
    if (nextFilters.page_key) params.set('page_key', nextFilters.page_key);
    if (nextFilters.setting_type) params.set('setting_type', nextFilters.setting_type);
    if (nextFilters.keyword) params.set('keyword', nextFilters.keyword);
    if (nextFilters.activeOnly) params.set('activeOnly', '1');

    setLoadingScreenSettings(true);
    setScreenError('');

    try {
      const response = await fetch(`/api/admin/screen-settings?${params.toString()}`, {
        method: 'GET',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '화면 설정 목록을 불러오지 못했습니다.');
      }

      setScreenSettings(Array.isArray(data.settings) ? data.settings : []);
      setScreenSummary(data.summary || {});
    } catch (error) {
      console.error('[admin] screen settings fetch failed:', error);
      setScreenError(error.message || '화면 설정 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingScreenSettings(false);
    }
  }, [makeAdminHeaders, screenFilters]);

  const handleScreenFormChange = useCallback((field, value) => {
    setScreenForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const resetScreenForm = useCallback(() => {
    setEditingScreenSettingId(null);
    setScreenForm(EMPTY_SCREEN_SETTING_FORM);
    setScreenError('');
    setScreenSuccess('');
  }, []);

  const startEditScreenSetting = useCallback((setting) => {
    setEditingScreenSettingId(setting.id);
    setScreenForm({
      page_key: setting.page_key || 'all',
      section_key: setting.section_key || 'common',
      setting_type: setting.setting_type || 'text',
      setting_key: setting.setting_key || '',
      setting_label: setting.setting_label || '',
      setting_value: setting.setting_value || '',
      description: setting.description || '',
      sort_order: Number(setting.sort_order || 0),
      is_active: Number(setting.is_active) ? 1 : 0,
    });
    setScreenSuccess('선택한 화면 설정을 수정할 수 있습니다.');
    setScreenError('');
  }, []);

  const validateScreenForm = useCallback(() => {
    if (!screenForm.setting_key.trim()) return '설정 키를 입력해주세요.';
    if (!/^[a-zA-Z0-9_-]{2,100}$/.test(screenForm.setting_key.trim())) {
      return '설정 키는 영문, 숫자, _, - 조합 2~100자로 입력해주세요.';
    }
    if (!screenForm.setting_label.trim()) return '관리 이름을 입력해주세요.';
    return '';
  }, [screenForm]);

  const handleScreenSettingSubmit = useCallback(async (event) => {
    event.preventDefault();

    const validationMessage = validateScreenForm();
    if (validationMessage) {
      setScreenSuccess('');
      setScreenError(validationMessage);
      return;
    }

    setSavingScreenSetting(true);
    setScreenError('');
    setScreenSuccess('');

    try {
      const payload = {
        ...screenForm,
        setting_key: screenForm.setting_key.trim(),
        setting_label: screenForm.setting_label.trim(),
        section_key: screenForm.section_key.trim() || 'common',
        sort_order: Number(screenForm.sort_order || 0),
        is_active: Number(screenForm.is_active) ? 1 : 0,
        admin_id: currentUser?.id || currentUser?.username || 'admin',
      };

      const url = editingScreenSettingId
        ? `/api/admin/screen-settings/${editingScreenSettingId}`
        : '/api/admin/screen-settings';
      const method = editingScreenSettingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: makeAdminHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '화면 설정 저장에 실패했습니다.');
      }

      setScreenSuccess(data.message || '화면 설정이 저장되었습니다.');
      resetScreenForm();
      fetchScreenSettings();
    } catch (error) {
      console.error('[admin] screen setting save failed:', error);
      setScreenError(error.message || '화면 설정 저장에 실패했습니다.');
    } finally {
      setSavingScreenSetting(false);
    }
  }, [currentUser, editingScreenSettingId, fetchScreenSettings, makeAdminHeaders, resetScreenForm, screenForm, validateScreenForm]);

  const handleBulkScreenSettingSave = useCallback(async () => {
    const validationMessage = validateScreenForm();
    if (validationMessage) {
      setScreenSuccess('');
      setScreenError(validationMessage);
      return;
    }

    setSavingScreenSetting(true);
    setScreenError('');
    setScreenSuccess('');

    try {
      const response = await fetch('/api/admin/screen-settings/bulk', {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({
          ...screenForm,
          page_key: 'all',
          admin_id: currentUser?.id || currentUser?.username || 'admin',
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '전체 페이지 공통 설정 저장에 실패했습니다.');
      }

      setScreenSuccess(data.message || '전체 페이지 공통 설정이 저장되었습니다.');
      setScreenForm((prev) => ({ ...prev, page_key: 'all' }));
      fetchScreenSettings({ page_key: screenFilters.page_key });
    } catch (error) {
      console.error('[admin] bulk screen setting save failed:', error);
      setScreenError(error.message || '전체 페이지 공통 설정 저장에 실패했습니다.');
    } finally {
      setSavingScreenSetting(false);
    }
  }, [currentUser, fetchScreenSettings, makeAdminHeaders, screenFilters.page_key, screenForm, validateScreenForm]);

  const handleToggleScreenSetting = useCallback(async (settingId) => {
    if (!settingId) return;
    setScreenError('');
    setScreenSuccess('');

    try {
      const response = await fetch(`/api/admin/screen-settings/${settingId}/toggle`, {
        method: 'PATCH',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ admin_id: currentUser?.id || currentUser?.username || 'admin' }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '활성 상태 변경에 실패했습니다.');
      }

      setScreenSuccess(data.message || '활성 상태가 변경되었습니다.');
      fetchScreenSettings();
    } catch (error) {
      console.error('[admin] screen setting toggle failed:', error);
      setScreenError(error.message || '활성 상태 변경에 실패했습니다.');
    }
  }, [currentUser, fetchScreenSettings, makeAdminHeaders]);

  const handleDeleteScreenSetting = useCallback(async (settingId) => {
    if (!settingId) return;
    const ok = window.confirm('선택한 화면 설정을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.');
    if (!ok) return;

    setScreenError('');
    setScreenSuccess('');

    try {
      const response = await fetch(`/api/admin/screen-settings/${settingId}`, {
        method: 'DELETE',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '화면 설정 삭제에 실패했습니다.');
      }

      setScreenSuccess(data.message || '화면 설정이 삭제되었습니다.');
      if (editingScreenSettingId === settingId) resetScreenForm();
      fetchScreenSettings();
    } catch (error) {
      console.error('[admin] screen setting delete failed:', error);
      setScreenError(error.message || '화면 설정 삭제에 실패했습니다.');
    }
  }, [editingScreenSettingId, fetchScreenSettings, makeAdminHeaders, resetScreenForm]);

  const handleScreenFilterChange = useCallback((field, value) => {
    const nextFilters = { ...screenFilters, [field]: value };
    setScreenFilters(nextFilters);
  }, [screenFilters]);

  const handleScreenFilterSubmit = useCallback((event) => {
    event.preventDefault();
    fetchScreenSettings(screenFilters);
  }, [fetchScreenSettings, screenFilters]);

  return {
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
  };
}
