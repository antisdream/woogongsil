// 관리자 기능 모듈입니다: useAdminClassSchedules
import { useCallback, useEffect, useState } from 'react';
import {
  CLASS_SCHEDULE_DEFAULT_STYLE,
  EMPTY_CLASS_SCHEDULE_FORM,
} from './adminUtils.js';

export default function useAdminClassSchedules({
  activeAdminTab,
  makeAdminHeaders,
}) {
  const [classSchedules, setClassSchedules] = useState([]);
  const [classScheduleSummary, setClassScheduleSummary] = useState({
    total: 0,
    active_count: 0,
    inactive_count: 0,
    first_date: '',
    last_date: '',
  });
  const [classScheduleFilters, setClassScheduleFilters] = useState({
    keyword: '',
    active: '',
    type: '',
  });
  const [classScheduleForm, setClassScheduleForm] = useState(EMPTY_CLASS_SCHEDULE_FORM);
  const [editingClassScheduleId, setEditingClassScheduleId] = useState(null);
  const [loadingClassSchedules, setLoadingClassSchedules] = useState(false);
  const [savingClassSchedule, setSavingClassSchedule] = useState(false);
  const [classScheduleError, setClassScheduleError] = useState('');
  const [classScheduleSuccess, setClassScheduleSuccess] = useState('');

  const fetchClassSchedules = useCallback(async (overrides = {}) => {
    const nextFilters = { ...classScheduleFilters, ...overrides };
    const query = new URLSearchParams();

    if (nextFilters.keyword) query.set('keyword', nextFilters.keyword);
    if (nextFilters.active === '1' || nextFilters.active === '0') query.set('active', nextFilters.active);
    if (nextFilters.type) query.set('type', nextFilters.type);

    setLoadingClassSchedules(true);
    setClassScheduleError('');

    try {
      const response = await fetch(`/api/admin/class-schedules?${query.toString()}`, {
        headers: makeAdminHeaders(),
      });

      const data = await response.json();

      if (response.ok === false || data.success === false) {
        throw new Error(data.message || '달력 일정 목록을 불러오지 못했습니다.');
      }

      setClassSchedules(Array.isArray(data.schedules) ? data.schedules : []);
      setClassScheduleSummary(data.summary || {
        total: 0,
        active_count: 0,
        inactive_count: 0,
        first_date: '',
        last_date: '',
      });
    } catch (error) {
      console.error('[admin] class schedules fetch failed:', error);
      setClassScheduleError(error.message || '달력 일정 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingClassSchedules(false);
    }
  }, [classScheduleFilters, makeAdminHeaders]);

  const resetClassScheduleForm = useCallback(() => {
    setClassScheduleForm(EMPTY_CLASS_SCHEDULE_FORM);
    setEditingClassScheduleId(null);
    setClassScheduleError('');
    setClassScheduleSuccess('');
  }, []);

  useEffect(() => {
    if (activeAdminTab === 'calendar') {
      fetchClassSchedules();
    }
  }, [activeAdminTab, fetchClassSchedules]);

  const handleClassScheduleFormChange = useCallback((field, value) => {
    setClassScheduleForm((prev) => {
      if (field === 'schedule_type') {
        const defaults = CLASS_SCHEDULE_DEFAULT_STYLE[value] || CLASS_SCHEDULE_DEFAULT_STYLE.class;
        return {
          ...prev,
          schedule_type: value,
          event_category: defaults.event_category,
          background_color: defaults.background_color,
          text_color: defaults.text_color,
          border_color: defaults.border_color,
          highlight_type: value === 'special'? 'glow' : 'none',
        };
      }

      return {
        ...prev,
        [field]: value,
      };
    });
  }, []);

  const validateClassScheduleForm = useCallback(() => {
    if (String(classScheduleForm.schedule_date || '').trim() === '') return '일정 날짜를 입력해주세요.';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(classScheduleForm.schedule_date || '').trim()) === false) {
      return '일정 날짜는 YYYY-MM-DD 형식으로 입력해주세요.';
    }

    if (String(classScheduleForm.schedule_type || 'class') === 'class') {
      if (String(classScheduleForm.course_title || '').trim() === '') return '수업 과정명을 입력해주세요.';
    } else if (String(classScheduleForm.event_title || classScheduleForm.course_title || '').trim() === '') {
      return '공휴일/시험일 등 특수 일정의 이벤트명을 입력해주세요.';
    }

    return '';
  }, [classScheduleForm]);

  const handleClassScheduleSubmit = useCallback(async (event) => {
    event.preventDefault();

    const validationMessage = validateClassScheduleForm();
    if (validationMessage) {
      setClassScheduleError(validationMessage);
      return;
    }

    setSavingClassSchedule(true);
    setClassScheduleError('');
    setClassScheduleSuccess('');

    const scheduleType = String(classScheduleForm.schedule_type || 'class').trim() || 'class';
    const isClassSchedule = scheduleType === 'class';
    const eventTitle = String(classScheduleForm.event_title || classScheduleForm.course_title || '').trim();
    const eventSubtitle = String(classScheduleForm.event_subtitle || classScheduleForm.topic_title || '').trim();

    const payload = {
      schedule_date: String(classScheduleForm.schedule_date || '').trim(),
      day_no: classScheduleForm.day_no === ''? null : Number(classScheduleForm.day_no),
      schedule_type: scheduleType,
      event_category: String(classScheduleForm.event_category || CLASS_SCHEDULE_DEFAULT_STYLE[scheduleType]?.event_category || '').trim(),
      course_title: isClassSchedule ? String(classScheduleForm.course_title || '').trim() : eventTitle,
      topic_title: isClassSchedule ? String(classScheduleForm.topic_title || '').trim() : eventSubtitle,
      event_title: isClassSchedule ? String(classScheduleForm.course_title || '').trim() : eventTitle,
      event_subtitle: isClassSchedule ? String(classScheduleForm.topic_title || '').trim() : eventSubtitle,
      background_color: String(classScheduleForm.background_color || '').trim(),
      text_color: String(classScheduleForm.text_color || '').trim(),
      border_color: String(classScheduleForm.border_color || '').trim(),
      highlight_type: String(classScheduleForm.highlight_type || 'none').trim(),
      memo: String(classScheduleForm.memo || classScheduleForm.admin_note || '').trim(),
      admin_note: String(classScheduleForm.admin_note || classScheduleForm.memo || '').trim(),
      sort_order: Number(classScheduleForm.sort_order || 0),
      is_active: Number(classScheduleForm.is_active) ? 1 : 0,
    };

    try {
      const isEditing = Boolean(editingClassScheduleId);
      const response = await fetch(
        isEditing ? `/api/admin/class-schedules/${editingClassScheduleId}` : '/api/admin/class-schedules',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: {
            ...makeAdminHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (response.ok === false || data.success === false) {
        throw new Error(data.message || '달력 일정 저장에 실패했습니다.');
      }

      setClassScheduleSuccess(data.message || '달력 일정이 저장되었습니다.');
      setClassScheduleForm(EMPTY_CLASS_SCHEDULE_FORM);
      setEditingClassScheduleId(null);
      fetchClassSchedules();
    } catch (error) {
      console.error('[admin] class schedule save failed:', error);
      setClassScheduleError(error.message || '달력 일정 저장에 실패했습니다.');
    } finally {
      setSavingClassSchedule(false);
    }
  }, [classScheduleForm, editingClassScheduleId, fetchClassSchedules, makeAdminHeaders, validateClassScheduleForm]);

  const startEditClassSchedule = useCallback((schedule) => {
    setEditingClassScheduleId(schedule.id);
    const scheduleType = schedule.schedule_type || schedule.scheduleType || 'class';
    const defaults = CLASS_SCHEDULE_DEFAULT_STYLE[scheduleType] || CLASS_SCHEDULE_DEFAULT_STYLE.class;
    setClassScheduleForm({
      schedule_date: schedule.schedule_date || schedule.date || '',
      day_no: schedule.day_no ?? schedule.day ?? '',
      schedule_type: scheduleType,
      event_category: schedule.event_category || schedule.eventCategory || defaults.event_category,
      course_title: schedule.course_title || schedule.courseTitle || schedule.title || '',
      topic_title: schedule.topic_title || schedule.topicTitle || schedule.subject || '',
      event_title: schedule.event_title || schedule.eventTitle || schedule.title || '',
      event_subtitle: schedule.event_subtitle || schedule.eventSubtitle || schedule.subtitle || '',
      background_color: schedule.background_color || schedule.backgroundColor || defaults.background_color,
      text_color: schedule.text_color || schedule.textColor || defaults.text_color,
      border_color: schedule.border_color || schedule.borderColor || defaults.border_color,
      highlight_type: schedule.highlight_type || schedule.highlightType || 'none',
      memo: schedule.memo || '',
      admin_note: schedule.admin_note || schedule.adminNote || schedule.memo || '',
      sort_order: schedule.sort_order ?? 0,
      is_active: Number(schedule.is_active) ? 1 : 0,
    });
    setClassScheduleError('');
    setClassScheduleSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleToggleClassSchedule = useCallback(async (scheduleId) => {
    setClassScheduleError('');
    setClassScheduleSuccess('');

    try {
      const response = await fetch(`/api/admin/class-schedules/${scheduleId}/toggle`, {
        method: 'PATCH',
        headers: makeAdminHeaders(),
      });

      const data = await response.json();

      if (response.ok === false || data.success === false) {
        throw new Error(data.message || '달력 일정 상태 변경에 실패했습니다.');
      }

      setClassScheduleSuccess(data.message || '달력 일정 상태가 변경되었습니다.');
      fetchClassSchedules();
    } catch (error) {
      console.error('[admin] class schedule toggle failed:', error);
      setClassScheduleError(error.message || '달력 일정 상태 변경에 실패했습니다.');
    }
  }, [fetchClassSchedules, makeAdminHeaders]);

  const handleDeleteClassSchedule = useCallback(async (scheduleId) => {
    const confirmed = window.confirm('선택한 달력 일정을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.');
    if (confirmed === false) return;

    setClassScheduleError('');
    setClassScheduleSuccess('');

    try {
      const response = await fetch(`/api/admin/class-schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: makeAdminHeaders(),
      });

      const data = await response.json();

      if (response.ok === false || data.success === false) {
        throw new Error(data.message || '달력 일정 삭제에 실패했습니다.');
      }

      if (Number(editingClassScheduleId) === Number(scheduleId)) {
        setClassScheduleForm(EMPTY_CLASS_SCHEDULE_FORM);
        setEditingClassScheduleId(null);
      }

      setClassScheduleSuccess(data.message || '달력 일정이 삭제되었습니다.');
      fetchClassSchedules();
    } catch (error) {
      console.error('[admin] class schedule delete failed:', error);
      setClassScheduleError(error.message || '달력 일정 삭제에 실패했습니다.');
    }
  }, [editingClassScheduleId, fetchClassSchedules, makeAdminHeaders]);

  const handleClassScheduleFilterChange = useCallback((field, value) => {
    const nextFilters = { ...classScheduleFilters, [field]: value };
    setClassScheduleFilters(nextFilters);
    fetchClassSchedules(nextFilters);
  }, [classScheduleFilters, fetchClassSchedules]);

  const handleClassScheduleFilterSubmit = useCallback((event) => {
    event.preventDefault();
    fetchClassSchedules(classScheduleFilters);
  }, [classScheduleFilters, fetchClassSchedules]);

  return {
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
  };
}
