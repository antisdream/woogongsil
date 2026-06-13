// 관리자 기능 모듈입니다: AdminCalendarTab
import React from 'react';
import {
    CLASS_SCHEDULE_HIGHLIGHT_OPTIONS,
    CLASS_SCHEDULE_TYPE_OPTIONS,
    formatDateTime,
} from '../adminUtils.js';

export default function AdminCalendarTab({
    fetchClassSchedules,
    loadingClassSchedules,
    classScheduleSummary,
    classSchedules,
    classScheduleError,
    classScheduleSuccess,
    handleClassScheduleSubmit,
    editingClassScheduleId,
    resetClassScheduleForm,
    classScheduleForm,
    handleClassScheduleFormChange,
    savingClassSchedule,
    classScheduleFilters,
    handleClassScheduleFilterSubmit,
    handleClassScheduleFilterChange,
    startEditClassSchedule,
    handleToggleClassSchedule,
    handleDeleteClassSchedule,
}) {
    return (
        <section className="admin-panel admin-calendar-section">
            <div className="admin-panel-head">
                <div>
                    <h2>달력·일정 관리</h2>
                    <p>홈 화면 달력에 표시되는 수업 일정을 DB 기준으로 추가·수정·삭제·활성화 관리합니다.</p>
                </div>
                <button type="button" className="admin-primary-mini-btn" onClick={() => fetchClassSchedules()} disabled={loadingClassSchedules}>
                    {loadingClassSchedules ? '새로고침 중...' : '일정 새로고침'}
                </button>
            </div>

            <div className="admin-question-summary-grid">
                <article>
                    <span>전체 일정</span>
                    <strong>{classScheduleSummary.total || classSchedules.length}개</strong>
                    <small>DB에 등록된 전체 달력 일정</small>
                </article>
                <article>
                    <span>활성 일정</span>
                    <strong>{classScheduleSummary.active_count || 0}개</strong>
                    <small>홈 달력에 표시되는 일정</small>
                </article>
                <article>
                    <span>비활성 일정</span>
                    <strong>{classScheduleSummary.inactive_count || 0}개</strong>
                    <small>홈 달력에서 숨김 처리된 일정</small>
                </article>
                <article>
                    <span>일정 범위</span>
                    <strong>{classScheduleSummary.first_date || '-'}</strong>
                    <small>{classScheduleSummary.last_date ? `~ ${classScheduleSummary.last_date}` : '마지막 일정 없음'}</small>
                </article>
            </div>

            {classScheduleError && <div className="admin-alert admin-alert-error">{classScheduleError}</div>}
            {classScheduleSuccess && <div className="admin-alert admin-alert-success">{classScheduleSuccess}</div>}

            <div className="admin-screen-manager-layout admin-calendar-manager-layout">
                <form className="admin-screen-form-card admin-calendar-form-card" onSubmit={handleClassScheduleSubmit}>
                    <div className="admin-card-title-row">
                        <div>
                            <h3>{editingClassScheduleId ? '선택 일정 수정' : '새 일정 추가'}</h3>
                            <p>날짜와 과정명을 입력하면 홈 달력에 표시됩니다.</p>
                        </div>
                        {editingClassScheduleId && (
                            <button className="admin-secondary-btn" type="button" onClick={resetClassScheduleForm}>신규 등록</button>
                        )}
                    </div>

                    <div className="admin-screen-form-grid">
                        <label>
                            일정 날짜
                            <input
                                type="date" value={classScheduleForm.schedule_date}
                                onChange={(event) => handleClassScheduleFormChange('schedule_date', event.target.value)}
                            />
                        </label>
                        <label>
                            일정 종류
                            <select
                                value={classScheduleForm.schedule_type}
                                onChange={(event) => handleClassScheduleFormChange('schedule_type', event.target.value)}
                            >
                                {CLASS_SCHEDULE_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            카테고리
                            <input
                                value={classScheduleForm.event_category}
                                onChange={(event) => handleClassScheduleFormChange('event_category', event.target.value)}
                                placeholder="예: 공휴일, 시험일, 수업"
                            />
                        </label>
                        <label>
                            수업 일차
                            <input
                                type="number" value={classScheduleForm.day_no}
                                onChange={(event) => handleClassScheduleFormChange('day_no', event.target.value)}
                                placeholder="수업만 입력 예: 38"
                            />
                        </label>
                        <label>
                            정렬 순서
                            <input
                                type="number" value={classScheduleForm.sort_order}
                                onChange={(event) => handleClassScheduleFormChange('sort_order', event.target.value)}
                            />
                        </label>
                        <label className="admin-screen-check-label admin-calendar-active-check">
                            <input
                                type="checkbox" checked={Number(classScheduleForm.is_active) === 1}
                                onChange={(event) => handleClassScheduleFormChange('is_active', event.target.checked ? 1 : 0)}
                            />
                            홈 달력에 표시
                        </label>
                    </div>

                    <div className="admin-screen-form-grid two-columns">
                        <label>
                            {classScheduleForm.schedule_type === 'class'? '과정명' : '이벤트명'}
                            <input
                                value={classScheduleForm.schedule_type === 'class'? classScheduleForm.course_title : classScheduleForm.event_title}
                                onChange={(event) => handleClassScheduleFormChange(classScheduleForm.schedule_type === 'class'? 'course_title' : 'event_title', event.target.value)}
                                placeholder={classScheduleForm.schedule_type === 'class'? '예: LLM(초거대언어모델)' : '예: 어린이날 / 필기시험'}
                            />
                        </label>
                        <label>
                            {classScheduleForm.schedule_type === 'class'? '세부 주제' : '부제/설명'}
                            <input
                                value={classScheduleForm.schedule_type === 'class'? classScheduleForm.topic_title : classScheduleForm.event_subtitle}
                                onChange={(event) => handleClassScheduleFormChange(classScheduleForm.schedule_type === 'class'? 'topic_title' : 'event_subtitle', event.target.value)}
                                placeholder={classScheduleForm.schedule_type === 'class'? '예: 자연어 데이터 준비' : '필요할 때만 입력'}
                            />
                        </label>
                    </div>

                    <div className="admin-screen-form-grid">
                        <label>
                            배경색
                            <input
                                type="color" value={classScheduleForm.background_color}
                                onChange={(event) => handleClassScheduleFormChange('background_color', event.target.value)}
                            />
                        </label>
                        <label>
                            글자색
                            <input
                                type="color" value={classScheduleForm.text_color}
                                onChange={(event) => handleClassScheduleFormChange('text_color', event.target.value)}
                            />
                        </label>
                        <label>
                            테두리색
                            <input
                                type="color" value={classScheduleForm.border_color}
                                onChange={(event) => handleClassScheduleFormChange('border_color', event.target.value)}
                            />
                        </label>
                        <label>
                            강조 방식
                            <select
                                value={classScheduleForm.highlight_type}
                                onChange={(event) => handleClassScheduleFormChange('highlight_type', event.target.value)}
                            >
                                {CLASS_SCHEDULE_HIGHLIGHT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <label className="admin-screen-full-label">
                        관리자 메모
                        <textarea
                            value={classScheduleForm.admin_note || classScheduleForm.memo}
                            onChange={(event) => handleClassScheduleFormChange('admin_note', event.target.value)}
                            placeholder="관리자만 확인할 메모를 입력하세요." rows={3}
                        />
                    </label>

                    <div className="admin-screen-form-bottom">
                        <small>같은 날짜와 같은 수업 일차는 중복 저장되지 않습니다.</small>
                        <div className="admin-screen-action-row">
                            <button className="admin-secondary-btn" type="button" onClick={resetClassScheduleForm}>초기화</button>
                            <button className="admin-primary-mini-btn" type="submit" disabled={savingClassSchedule}>
                                {savingClassSchedule ? '저장 중...' : editingClassScheduleId ? '수정 저장' : '신규 추가'}
                            </button>
                        </div>
                    </div>
                </form>

                <aside className="admin-screen-preview-card admin-calendar-preview-card">
                    <h3>달력 표시 미리보기</h3>
                    <p>저장 후 홈 화면 달력에서 아래 형식으로 표시됩니다.</p>
                    <div className="admin-calendar-preview-box" style={{ borderColor: classScheduleForm.border_color }}>
                        <span>{classScheduleForm.schedule_date || 'YYYY-MM-DD'} · {classScheduleForm.event_category}</span>
                        <strong
                            style={{
                                display: 'block',
                                background: classScheduleForm.schedule_type === 'holiday'? 'transparent' : classScheduleForm.background_color,
                                color: classScheduleForm.schedule_type === 'holiday'? '#ef4444' : classScheduleForm.text_color,
                                border: classScheduleForm.highlight_type === 'outline'? `1px solid ${classScheduleForm.border_color}` : 'none',
                                borderRadius: 6,
                                padding: '6px 8px'
                            }}
                        >
                            {classScheduleForm.schedule_type === 'class'? `${classScheduleForm.day_no || '-'}일차 - ${classScheduleForm.course_title || '과정명'}`
                                : (classScheduleForm.event_title || classScheduleForm.course_title || '이벤트명')}
                        </strong>
                        <p>{classScheduleForm.schedule_type === 'class'? (classScheduleForm.topic_title || '세부 주제 미입력') : (classScheduleForm.event_subtitle || '부제 없음')}</p>
                        <small>{Number(classScheduleForm.is_active) ? '활성 상태' : '비활성 상태'}</small>
                    </div>
                    <div className="admin-screen-help-box">
                        <strong>표시 규칙</strong>
                        <p>홈 달력은 wgs_class_schedules DB만 사용하며, 공휴일/시험일 같은 카테고리는 화면 문구에 붙이지 않고 이벤트명만 표시합니다.</p>
                    </div>
                </aside>
            </div>

            <form className="admin-question-toolbar admin-calendar-filter-row" onSubmit={handleClassScheduleFilterSubmit}>
                <input
                    value={classScheduleFilters.keyword}
                    onChange={(event) => handleClassScheduleFilterChange('keyword', event.target.value)}
                    placeholder="과정명, 세부 주제, 메모 검색"
                />
                <select
                    value={classScheduleFilters.active}
                    onChange={(event) => handleClassScheduleFilterChange('active', event.target.value)}
                >
                    <option value="">전체 상태</option>
                    <option value="1">활성만</option>
                    <option value="0">비활성만</option>
                </select>
                <select
                    value={classScheduleFilters.type}
                    onChange={(event) => handleClassScheduleFilterChange('type', event.target.value)}
                >
                    <option value="">전체 종류</option>
                    {CLASS_SCHEDULE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <button type="submit">검색</button>
            </form>

            <div className="admin-question-list-card admin-calendar-list-card">
                <div className="admin-card-title-row">
                    <h3>달력 일정 목록</h3>
                    <span className="admin-small-status">{loadingClassSchedules ? '불러오는 중...' : `총 ${classSchedules.length}개 표시`}</span>
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
                            {classSchedules.length === 0 ? (
                                <tr><td colSpan="10" className="admin-empty-cell">등록된 달력 일정이 없습니다.</td></tr>
                            ) : classSchedules.map((schedule) => (
                                <tr key={schedule.id} className={Number(schedule.is_active) ? '' : 'admin-row-muted'}>
                                    <td><strong>{schedule.schedule_date || schedule.date}</strong><small>{schedule.weekday_label || schedule.weekday || ''}</small></td>
                                    <td><span className="admin-badge">{schedule.event_category || schedule.eventCategory || schedule.schedule_type || schedule.scheduleType || '수업'}</span></td>
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
                                    <td>{formatDateTime(schedule.updated_at)}</td>
                                    <td>
                                        <div className="admin-chip-row admin-calendar-actions">
                                            <button type="button" onClick={() => startEditClassSchedule(schedule)}>수정</button>
                                            <button type="button" onClick={() => handleToggleClassSchedule(schedule.id)}>{Number(schedule.is_active) ? '끄기' : '켜기'}</button>
                                            <button type="button" className="danger" onClick={() => handleDeleteClassSchedule(schedule.id)}>삭제</button>
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
