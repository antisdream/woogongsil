import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  CLASS_SCHEDULE_DEFAULT_STYLE,
  CLASS_SCHEDULE_HIGHLIGHT_OPTIONS,
  CLASS_SCHEDULE_TYPE_OPTIONS,
  formatDateTime,
} from '../admin/adminUtils.js';

const EMPTY_USER_CALENDAR_FORM = {
  schedule_date: '',
  day_no: '',
  schedule_type: 'personal',
  event_category: '개인일정',
  course_title: '',
  topic_title: '',
  event_title: '',
  event_subtitle: '',
  background_color: '#1e40af',
  text_color: '#ffffff',
  border_color: '#1e40af',
  highlight_type: 'none',
  memo: '',
  sort_order: 0,
  is_active: 1,
};

const USER_SCHEDULE_TYPE_OPTIONS = [
  { value: 'personal', label: '개인일정' },
  ...CLASS_SCHEDULE_TYPE_OPTIONS.filter((option) => option.value !== 'personal'),
];

function getDefaultStyle(scheduleType) {
  if (scheduleType === 'personal') {
    return {
      background_color: '#1e40af',
      text_color: '#ffffff',
      border_color: '#1e40af',
      event_category: '개인일정',
    };
  }
  return CLASS_SCHEDULE_DEFAULT_STYLE[scheduleType] || CLASS_SCHEDULE_DEFAULT_STYLE.class;
}

export default function UserCalendarManager({ getSessionAuth }) {
  const [schedules, setSchedules] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    active_count: 0,
    inactive_count: 0,
    first_date: '',
    last_date: '',
  });
  const [filters, setFilters] = useState({ keyword: '', active: '', type: '' });
  const [form, setForm] = useState(EMPTY_USER_CALENDAR_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const notifyCalendar = useCallback((type, text) => {
    if (!text) return;
    const notify = toast[type] || toast.info;
    notify(text, { autoClose: type === 'error' ? 2800 : 2200 });
  }, []);
  const setError = useCallback((text) => notifyCalendar('error', text), [notifyCalendar]);
  const setSuccess = useCallback((text) => notifyCalendar('success', text), [notifyCalendar]);

  const auth = useMemo(() => getSessionAuth(), [getSessionAuth]);

  const fetchSchedules = useCallback(async (overrides = {}) => {
    const nextFilters = { ...filters, ...overrides };
    const query = new URLSearchParams({ ...getSessionAuth() });

    if (nextFilters.keyword) query.set('keyword', nextFilters.keyword);
    if (nextFilters.active === '1' || nextFilters.active === '0') query.set('active', nextFilters.active);
    if (nextFilters.type) query.set('type', nextFilters.type);

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/user/calendar-events?${query.toString()}`);
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.msg || data.message || '일정 목록을 불러오지 못했습니다.');
      }

      setSchedules(Array.isArray(data.schedules) ? data.schedules : []);
      setSummary(data.summary || {
        total: 0,
        active_count: 0,
        inactive_count: 0,
        first_date: '',
        last_date: '',
      });
    } catch (fetchError) {
      console.error('[mypage calendar] fetch failed:', fetchError);
      setError(fetchError.message || '일정 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [filters, getSessionAuth, setError]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const updateForm = useCallback((field, value) => {
    setForm((prev) => {
      if (field === 'schedule_type') {
        const defaults = getDefaultStyle(value);
        return {
          ...prev,
          schedule_type: value,
          event_category: defaults.event_category,
          background_color: defaults.background_color,
          text_color: defaults.text_color,
          border_color: defaults.border_color,
          highlight_type: value === 'special' ? 'glow' : 'none',
        };
      }
      return { ...prev, [field]: value };
    });
  }, []);

  const resetForm = useCallback(() => {
    setForm(EMPTY_USER_CALENDAR_FORM);
    setEditingId(null);
    setError('');
    setSuccess('');
  }, [setError, setSuccess]);

  const validateForm = useCallback(() => {
    if (!String(form.schedule_date || '').trim()) return '일정 날짜를 입력해주세요.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.schedule_date || '').trim())) return '일정 날짜는 YYYY-MM-DD 형식이어야 합니다.';

    const scheduleType = String(form.schedule_type || 'personal');
    if (scheduleType === 'class') {
      if (!String(form.course_title || '').trim()) return '과정명을 입력해주세요.';
    } else if (!String(form.event_title || form.course_title || '').trim()) {
      return '일정 표시명을 입력해주세요.';
    }

    return '';
  }, [form]);

  const buildPayload = useCallback(() => {
    const scheduleType = String(form.schedule_type || 'personal').trim() || 'personal';
    const isClassSchedule = scheduleType === 'class';
    const eventTitle = String(form.event_title || form.course_title || '').trim();
    const eventSubtitle = String(form.event_subtitle || form.topic_title || '').trim();

    return {
      ...auth,
      schedule_date: String(form.schedule_date || '').trim(),
      day_no: form.day_no === '' ? null : Number(form.day_no),
      schedule_type: scheduleType,
      event_category: String(form.event_category || getDefaultStyle(scheduleType).event_category || '').trim(),
      course_title: isClassSchedule ? String(form.course_title || '').trim() : eventTitle,
      topic_title: isClassSchedule ? String(form.topic_title || '').trim() : eventSubtitle,
      event_title: isClassSchedule ? String(form.course_title || '').trim() : eventTitle,
      event_subtitle: isClassSchedule ? String(form.topic_title || '').trim() : eventSubtitle,
      background_color: String(form.background_color || '').trim(),
      text_color: String(form.text_color || '').trim(),
      border_color: String(form.border_color || '').trim(),
      highlight_type: String(form.highlight_type || 'none').trim(),
      memo: String(form.memo || '').trim(),
      sort_order: Number(form.sort_order || 0),
      is_active: Number(form.is_active) ? 1 : 0,
    };
  }, [auth, form]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    const validationMessage = validateForm();
    if (validationMessage) {
      setError('');
      toast.warn(validationMessage, { autoClose: 2200 });
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const isEditing = Boolean(editingId);
      const response = await fetch(isEditing ? `/api/user/calendar-events/${editingId}` : '/api/user/calendar-events', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.msg || data.message || '일정 저장에 실패했습니다.');
      }

      setSuccess(data.message || '일정이 저장되었습니다.');
      setForm(EMPTY_USER_CALENDAR_FORM);
      setEditingId(null);
      fetchSchedules();
    } catch (submitError) {
      console.error('[mypage calendar] save failed:', submitError);
      setError(submitError.message || '일정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [buildPayload, editingId, fetchSchedules, setError, setSuccess, validateForm]);

  const startEdit = useCallback((schedule) => {
    const scheduleType = schedule.schedule_type || schedule.scheduleType || 'personal';
    const defaults = getDefaultStyle(scheduleType);
    setEditingId(schedule.id);
    setForm({
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
      sort_order: schedule.sort_order ?? schedule.sortOrder ?? 0,
      is_active: Number(schedule.is_active ?? schedule.isActive) ? 1 : 0,
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setError, setSuccess]);

  const toggleSchedule = useCallback(async (scheduleId) => {
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/user/calendar-events/${scheduleId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.msg || data.message || '일정 상태 변경에 실패했습니다.');
      }
      setSuccess(data.message || '일정 상태가 변경되었습니다.');
      fetchSchedules();
    } catch (toggleError) {
      console.error('[mypage calendar] toggle failed:', toggleError);
      setError(toggleError.message || '일정 상태 변경에 실패했습니다.');
    }
  }, [auth, fetchSchedules, setError, setSuccess]);

  const deleteSchedule = useCallback(async (scheduleId) => {
    const confirmed = window.confirm('선택한 달력 일정을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.');
    if (!confirmed) return;

    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/user/calendar-events/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.msg || data.message || '일정 삭제에 실패했습니다.');
      }
      if (Number(editingId) === Number(scheduleId)) resetForm();
      setSuccess(data.message || '일정이 삭제되었습니다.');
      fetchSchedules();
    } catch (deleteError) {
      console.error('[mypage calendar] delete failed:', deleteError);
      setError(deleteError.message || '일정 삭제에 실패했습니다.');
    }
  }, [auth, editingId, fetchSchedules, resetForm, setError, setSuccess]);

  const handleFilterChange = useCallback((field, value) => {
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    fetchSchedules(nextFilters);
  }, [fetchSchedules, filters]);

  const handleFilterSubmit = useCallback((event) => {
    event.preventDefault();
    fetchSchedules(filters);
  }, [fetchSchedules, filters]);

  return (
    <section className="admin-panel admin-calendar-section mypage-calendar-section">
      <div className="admin-panel-head">
        <div>
          <h2>달력 일정 관리</h2>
          <p>내 홈 달력에 표시할 개인 일정과 배정 일정을 추가·수정·삭제·활성화 관리합니다.</p>
        </div>
        <button type="button" className="admin-primary-mini-btn" onClick={() => fetchSchedules()} disabled={loading}>
          {loading ? '새로고침 중...' : '일정 새로고침'}
        </button>
      </div>

      <div className="admin-question-summary-grid">
        <article>
          <span>전체 일정</span>
          <strong>{summary.total || schedules.length}개</strong>
          <small>내 계정에 등록된 전체 일정</small>
        </article>
        <article>
          <span>활성 일정</span>
          <strong>{summary.active_count || 0}개</strong>
          <small>홈 달력에 표시되는 일정</small>
        </article>
        <article>
          <span>비활성 일정</span>
          <strong>{summary.inactive_count || 0}개</strong>
          <small>홈 달력에서 숨긴 일정</small>
        </article>
        <article>
          <span>일정 범위</span>
          <strong>{summary.first_date || '-'}</strong>
          <small>{summary.last_date ? `~ ${summary.last_date}` : '등록된 일정 없음'}</small>
        </article>
      </div>

      <div className="admin-screen-manager-layout admin-calendar-manager-layout">
        <form className="admin-screen-form-card admin-calendar-form-card" onSubmit={handleSubmit}>
          <div className="admin-card-title-row">
            <div>
              <h3>{editingId ? '선택 일정 수정' : '새 일정 추가'}</h3>
              <p>날짜와 일정명을 입력하면 내 홈 달력에 표시됩니다.</p>
            </div>
            {editingId && <button className="admin-secondary-btn" type="button" onClick={resetForm}>신규 등록</button>}
          </div>

          <div className="admin-screen-form-grid">
            <label>
              일정 날짜
              <input type="date" value={form.schedule_date} onChange={(event) => updateForm('schedule_date', event.target.value)} />
            </label>
            <label>
              일정 종류
              <select value={form.schedule_type} onChange={(event) => updateForm('schedule_type', event.target.value)}>
                {USER_SCHEDULE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              카테고리
              <input value={form.event_category} onChange={(event) => updateForm('event_category', event.target.value)} placeholder="예: 개인일정, 시험, 수업" />
            </label>
            <label>
              일차
              <input type="number" value={form.day_no} onChange={(event) => updateForm('day_no', event.target.value)} placeholder="필요할 때만 입력" />
            </label>
            <label>
              정렬 순서
              <input type="number" value={form.sort_order} onChange={(event) => updateForm('sort_order', event.target.value)} />
            </label>
            <label className="admin-screen-check-label admin-calendar-active-check">
              <input type="checkbox" checked={Number(form.is_active) === 1} onChange={(event) => updateForm('is_active', event.target.checked ? 1 : 0)} />
              홈 달력에 표시
            </label>
          </div>

          <div className="admin-screen-form-grid two-columns">
            <label>
              {form.schedule_type === 'class' ? '과정명' : '일정명'}
              <input
                value={form.schedule_type === 'class' ? form.course_title : form.event_title}
                onChange={(event) => updateForm(form.schedule_type === 'class' ? 'course_title' : 'event_title', event.target.value)}
                placeholder={form.schedule_type === 'class' ? '예: LLM(초거대언어모델)' : '예: 개인 공부 / 면접 준비'}
              />
            </label>
            <label>
              {form.schedule_type === 'class' ? '세부 주제' : '부제/내용'}
              <input
                value={form.schedule_type === 'class' ? form.topic_title : form.event_subtitle}
                onChange={(event) => updateForm(form.schedule_type === 'class' ? 'topic_title' : 'event_subtitle', event.target.value)}
                placeholder={form.schedule_type === 'class' ? '예: 자연어 데이터 준비' : '필요한 설명을 입력'}
              />
            </label>
          </div>

          <div className="admin-screen-form-grid">
            <label>
              배경색
              <input type="color" value={form.background_color} onChange={(event) => updateForm('background_color', event.target.value)} />
            </label>
            <label>
              글자색
              <input type="color" value={form.text_color} onChange={(event) => updateForm('text_color', event.target.value)} />
            </label>
            <label>
              테두리색
              <input type="color" value={form.border_color} onChange={(event) => updateForm('border_color', event.target.value)} />
            </label>
            <label>
              강조 방식
              <select value={form.highlight_type} onChange={(event) => updateForm('highlight_type', event.target.value)}>
                {CLASS_SCHEDULE_HIGHLIGHT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <label className="admin-screen-full-label">
            메모
            <textarea value={form.memo} onChange={(event) => updateForm('memo', event.target.value)} placeholder="내가 확인할 메모를 입력하세요." rows={3} />
          </label>

          <div className="admin-screen-form-bottom">
            <small>내 일정은 내 계정으로 로그인했을 때만 홈 달력에 표시됩니다.</small>
            <div className="admin-screen-action-row">
              <button className="admin-secondary-btn" type="button" onClick={resetForm}>초기화</button>
              <button className="admin-primary-mini-btn" type="submit" disabled={saving}>
                {saving ? '저장 중...' : editingId ? '수정 저장' : '신규 추가'}
              </button>
            </div>
          </div>
        </form>

        <aside className="admin-screen-preview-card admin-calendar-preview-card">
          <h3>달력 표시 미리보기</h3>
          <p>저장 후 내 홈 화면 달력에서 아래 형식으로 표시됩니다.</p>
          <div className="admin-calendar-preview-box" style={{ borderColor: form.border_color }}>
            <span>{form.schedule_date || 'YYYY-MM-DD'} · {form.event_category}</span>
            <strong
              style={{
                display: 'block',
                background: form.schedule_type === 'holiday' ? 'transparent' : form.background_color,
                color: form.schedule_type === 'holiday' ? '#ef4444' : form.text_color,
                border: form.highlight_type === 'outline' ? `1px solid ${form.border_color}` : 'none',
                borderRadius: 6,
                padding: '6px 8px',
              }}
            >
              {form.schedule_type === 'class' ? `${form.day_no || '-'}일차 - ${form.course_title || '과정명'}`
                : (form.event_title || form.course_title || '일정명')}
            </strong>
            <p>{form.schedule_type === 'class' ? (form.topic_title || '세부 주제 미입력') : (form.event_subtitle || '부제 없음')}</p>
            <small>{Number(form.is_active) ? '활성 상태' : '비활성 상태'}</small>
          </div>
        </aside>
      </div>

      <form className="admin-question-toolbar admin-calendar-filter-row" onSubmit={handleFilterSubmit}>
        <input value={filters.keyword} onChange={(event) => handleFilterChange('keyword', event.target.value)} placeholder="일정명, 세부 주제, 메모 검색" />
        <select value={filters.active} onChange={(event) => handleFilterChange('active', event.target.value)}>
          <option value="">전체 상태</option>
          <option value="1">활성만</option>
          <option value="0">비활성만</option>
        </select>
        <select value={filters.type} onChange={(event) => handleFilterChange('type', event.target.value)}>
          <option value="">전체 종류</option>
          {USER_SCHEDULE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="submit">검색</button>
      </form>

      <div className="admin-question-list-card admin-calendar-list-card">
        <div className="admin-card-title-row">
          <h3>달력 일정 목록</h3>
          <span className="admin-small-status">{loading ? '불러오는 중...' : `총 ${schedules.length}개 표시`}</span>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-user-table admin-calendar-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>종류</th>
                <th>일차</th>
                <th>표시명</th>
                <th>세부 주제/부제</th>
                <th>색상</th>
                <th>상태</th>
                <th>정렬</th>
                <th>수정일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr><td colSpan="10" className="admin-empty-cell">등록된 달력 일정이 없습니다.</td></tr>
              ) : schedules.map((schedule) => (
                <tr key={schedule.id} className={Number(schedule.is_active) ? '' : 'admin-row-muted'}>
                  <td><strong>{schedule.schedule_date || schedule.date}</strong><small>{schedule.weekday_label || schedule.weekday || ''}</small></td>
                  <td><span className="admin-badge">{schedule.event_category || schedule.eventCategory || schedule.schedule_type || schedule.scheduleType || '개인일정'}</span></td>
                  <td>{schedule.day_no ?? schedule.day ?? '-'}</td>
                  <td>{schedule.course_title || schedule.event_title || schedule.title}</td>
                  <td>{schedule.topic_title || schedule.event_subtitle || schedule.subject || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      {[schedule.background_color || schedule.backgroundColor, schedule.text_color || schedule.textColor, schedule.border_color || schedule.borderColor].filter(Boolean).map((color, index) => (
                        <span key={`${schedule.id}-color-${index}`} title={color} style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #cbd5e1', background: color, display: 'inline-block' }} />
                      ))}
                    </div>
                  </td>
                  <td><span className={Number(schedule.is_active) ? 'admin-badge admin-badge-live' : 'admin-badge'}>{Number(schedule.is_active) ? '활성' : '비활성'}</span></td>
                  <td>{schedule.sort_order ?? 0}</td>
                  <td>{formatDateTime(schedule.updated_at || schedule.updatedAt)}</td>
                  <td>
                    <div className="admin-chip-row admin-calendar-actions">
                      <button type="button" onClick={() => startEdit(schedule)}>수정</button>
                      <button type="button" onClick={() => toggleSchedule(schedule.id)}>{Number(schedule.is_active) ? '끄기' : '켜기'}</button>
                      <button type="button" className="danger" onClick={() => deleteSchedule(schedule.id)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
