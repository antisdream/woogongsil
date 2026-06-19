// 관리자 기능 모듈입니다: AdminDisplayTab
import React from 'react';
import {
    SCREEN_SETTING_PAGE_OPTIONS,
    SCREEN_SETTING_TYPE_OPTIONS,
    formatDateTime,
} from '../adminUtils.js';

const LAYOUT_ALIGN_OPTIONS = [
    { value: 'left', label: '왼쪽' },
    { value: 'center', label: '가운데' },
    { value: 'right', label: '오른쪽' },
];

const normalizeLayoutNumber = (value, fallback) => {
    const numericValue = Number(String(value || '').replace('%', ''));
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const getLayoutControlType = (settingKey = '') => {
    const key = String(settingKey).toLowerCase();
    if (key.endsWith('_align') || key.includes('align')) return 'align';
    if (key.includes('offset')) return 'offset';
    if (key.includes('width')) return 'percent';
    return 'text';
};

function ScreenSettingValueControl({ screenForm, handleScreenFormChange }) {
    if (screenForm.setting_type === 'color') {
        return (
            <div className="admin-screen-color-row">
                <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(screenForm.setting_value) ? screenForm.setting_value : '#38bdf8'} onChange={(event) => handleScreenFormChange('setting_value', event.target.value)} />
                <input value={screenForm.setting_value} onChange={(event) => handleScreenFormChange('setting_value', event.target.value)} placeholder="#38bdf8 또는 CSS 색상값" />
            </div>
        );
    }

    if (screenForm.setting_type === 'layout') {
        const controlType = getLayoutControlType(screenForm.setting_key);

        if (controlType === 'align') {
            return (
                <div className="admin-screen-layout-control">
                    <select value={screenForm.setting_value || 'center'} onChange={(event) => handleScreenFormChange('setting_value', event.target.value)}>
                        {LAYOUT_ALIGN_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <small>위치 정렬은 left, center, right 값으로 저장됩니다.</small>
                </div>
            );
        }

        if (controlType === 'offset') {
            const offsetValue = normalizeLayoutNumber(screenForm.setting_value, 0);
            return (
                <div className="admin-screen-layout-control">
                    <input
                        type="range"
                        min="-200"
                        max="200"
                        step="10"
                        value={Math.min(200, Math.max(-200, offsetValue))}
                        onChange={(event) => handleScreenFormChange('setting_value', event.target.value)}
                    />
                    <strong>{Math.min(200, Math.max(-200, offsetValue))}px</strong>
                    <small>음수는 왼쪽/위쪽, 양수는 오른쪽/아래쪽으로 이동합니다.</small>
                </div>
            );
        }

        if (controlType === 'percent') {
            const widthValue = Math.min(100, Math.max(60, normalizeLayoutNumber(screenForm.setting_value, 100)));
            return (
                <div className="admin-screen-layout-control">
                    <input
                        type="range"
                        min="60"
                        max="100"
                        step="10"
                        value={widthValue}
                        onChange={(event) => handleScreenFormChange('setting_value', `${event.target.value}%`)}
                    />
                    <strong>{widthValue}%</strong>
                    <small>콘텐츠 너비는 60%부터 100%까지 10% 단위로 저장됩니다.</small>
                </div>
            );
        }

        return (
            <div className="admin-screen-layout-control">
                <input value={screenForm.setting_value} onChange={(event) => handleScreenFormChange('setting_value', event.target.value)} placeholder="예: 24px, 100%, center" />
                <small>위치/간격/크기값은 연결된 화면에서 허용한 값만 실제로 반영됩니다.</small>
            </div>
        );
    }

    return (
        <textarea value={screenForm.setting_value} onChange={(event) => handleScreenFormChange('setting_value', event.target.value)} placeholder={screenForm.setting_type === 'image'? '예: /images/banner.png 또는 https://...' : '관리할 문구, 크기값, CSS값 등을 입력'} rows={5} />
    );
}

export default function AdminDisplayTab({
    fetchScreenSettings,
    loadingScreenSettings,
    screenSummary,
    screenError,
    screenSuccess,
    handleScreenSettingSubmit,
    editingScreenSettingId,
    resetScreenForm,
    screenForm,
    handleScreenFormChange,
    handleBulkScreenSettingSave,
    savingScreenSetting,
    screenFilters,
    handleScreenFilterSubmit,
    handleScreenFilterChange,
    screenSettings,
    startEditScreenSetting,
    handleToggleScreenSetting,
    handleDeleteScreenSetting,
}) {
    return (
    <section className="admin-panel admin-display-section">
      <div className="admin-panel-head">
        <div>
          <h2>화면 설정 관리</h2>
          <p>각 페이지별 문구, 레이아웃 값, 색상, 이미지 경로를 등록·수정·삭제하고 전체 페이지 공통 설정으로도 관리합니다.</p>
        </div>
        <button type="button" className="admin-primary-mini-btn" onClick={() => fetchScreenSettings()} disabled={loadingScreenSettings}>
          {loadingScreenSettings ? '새로고침 중...' : '설정 새로고침'}
        </button>
      </div>

      <div className="admin-question-summary-grid">
        <article>
          <span>전체 설정</span>
          <strong>{screenSummary.total_count || 0}개</strong>
          <small>등록된 화면 설정 전체</small>
        </article>
        <article>
          <span>활성 설정</span>
          <strong>{screenSummary.active_count || 0}개</strong>
          <small>사용 가능 상태</small>
        </article>
        <article>
          <span>문구/레이아웃</span>
          <strong>{Number(screenSummary.text_count || 0) + Number(screenSummary.layout_count || 0)}개</strong>
          <small>텍스트와 배치 관리</small>
        </article>
        <article>
          <span>색상/이미지</span>
          <strong>{Number(screenSummary.color_count || 0) + Number(screenSummary.image_count || 0)}개</strong>
          <small>디자인 리소스 관리</small>
        </article>
      </div>

      {screenError && <div className="admin-alert admin-alert-error">{screenError}</div>}
      {screenSuccess && <div className="admin-alert admin-alert-success">{screenSuccess}</div>}

      <div className="admin-screen-manager-layout">
        <form className="admin-screen-form-card" onSubmit={handleScreenSettingSubmit}>
          <div className="admin-card-title-row">
            <div>
              <h3>{editingScreenSettingId ? '선택 설정 수정' : '새 화면 설정 추가'}</h3>
              <p>값만 저장하며, 연결된 페이지 설정을 통해 화면에 반영됩니다. 기본 목록은 홈 화면의 활성 설정만 보여주므로 필요할 때 전체 페이지/비활성 포함으로 검색하세요.</p>
            </div>
            {editingScreenSettingId && (
              <button className="admin-secondary-btn" type="button" onClick={resetScreenForm}>신규 등록</button>
            )}
          </div>

          <div className="admin-screen-form-grid">
            <label>
              적용 페이지
              <select value={screenForm.page_key} onChange={(event) => handleScreenFormChange('page_key', event.target.value)}>
                {SCREEN_SETTING_PAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              설정 종류
              <select value={screenForm.setting_type} onChange={(event) => handleScreenFormChange('setting_type', event.target.value)}>
                {SCREEN_SETTING_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              섹션 키
              <input value={screenForm.section_key} onChange={(event) => handleScreenFormChange('section_key', event.target.value)} placeholder="예: hero, header, card" />
            </label>
            <label>
              정렬 순서
              <input type="number" value={screenForm.sort_order} onChange={(event) => handleScreenFormChange('sort_order', event.target.value)} />
            </label>
          </div>

          <div className="admin-screen-form-grid two-columns">
            <label>
              설정 키
              <input value={screenForm.setting_key} onChange={(event) => handleScreenFormChange('setting_key', event.target.value)} placeholder="예: hero_title" />
            </label>
            <label>
              관리자 표시 이름
              <input value={screenForm.setting_label} onChange={(event) => handleScreenFormChange('setting_label', event.target.value)} placeholder="예: 홈 메인 제목" />
            </label>
          </div>

          <label className="admin-screen-full-label">
            설정 값
            <ScreenSettingValueControl screenForm={screenForm} handleScreenFormChange={handleScreenFormChange} />
          </label>

          <label className="admin-screen-full-label">
            관리자 메모
            <textarea value={screenForm.description} onChange={(event) => handleScreenFormChange('description', event.target.value)} placeholder="이 설정을 어디에 쓰는지 적어두면 AWS 배포 후 유지보수할 때 편합니다." rows={3} />
          </label>

          <div className="admin-screen-form-bottom">
            <label className="admin-screen-check-label">
              <input type="checkbox" checked={Number(screenForm.is_active) === 1} onChange={(event) => handleScreenFormChange('is_active', event.target.checked ? 1 : 0)} />
              활성 상태로 저장
            </label>
            <div className="admin-screen-action-row">
              <button className="admin-secondary-btn" type="button" onClick={handleBulkScreenSettingSave} disabled={savingScreenSetting}>전체 페이지 공통 저장</button>
              <button className="admin-primary-mini-btn" type="submit" disabled={savingScreenSetting}>{savingScreenSetting ? '저장 중...' : editingScreenSettingId ? '수정 저장' : '신규 추가'}</button>
            </div>
          </div>
        </form>

        <aside className="admin-screen-preview-card">
          <h3>설정 미리보기</h3>
          <p>선택한 설정 값이 어떻게 관리되는지 확인합니다.</p>
          <div className="admin-screen-preview-box">
            <span>{SCREEN_SETTING_PAGE_OPTIONS.find((option) => option.value === screenForm.page_key)?.label || screenForm.page_key}</span>
            <strong>{screenForm.setting_label || '관리 이름 미입력'}</strong>
            <small>{screenForm.section_key || 'common'} / {screenForm.setting_key || 'setting_key'}</small>
            {screenForm.setting_type === 'color' && screenForm.setting_value ? <div className="admin-screen-color-preview" style={{ background: screenForm.setting_value }} /> : null}
            <p>{screenForm.setting_value || '설정 값이 아직 없습니다.'}</p>
          </div>
          <div className="admin-screen-help-box">
            <strong>현재 적용 방식</strong>
            <p>화면 설정 저장소와 관리자 화면을 추가했습니다. 화면 반영은 연결용 API(/api/screen-settings)를 통해 안전하게 처리됩니다.</p>
          </div>
        </aside>
      </div>

      <form className="admin-question-toolbar admin-screen-filter-row" onSubmit={handleScreenFilterSubmit}>
        <select value={screenFilters.page_key} onChange={(event) => handleScreenFilterChange('page_key', event.target.value)}>
          <option value="">전체 페이지</option>
          {SCREEN_SETTING_PAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={screenFilters.setting_type} onChange={(event) => handleScreenFilterChange('setting_type', event.target.value)}>
          <option value="">전체 종류</option>
          {SCREEN_SETTING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input value={screenFilters.keyword} onChange={(event) => handleScreenFilterChange('keyword', event.target.value)} placeholder="설정 키, 이름, 값, 메모 검색" />
        <label className="admin-screen-check-label filter-check">
          <input type="checkbox" checked={screenFilters.activeOnly} onChange={(event) => handleScreenFilterChange('activeOnly', event.target.checked)} />
          활성만 보기
        </label>
        <button type="submit">검색</button>
      </form>

      <div className="admin-question-list-card admin-screen-list-card">
        <div className="admin-card-title-row">
          <h3>화면 설정 목록</h3>
          <span className="admin-small-status">{loadingScreenSettings ? '불러오는 중...' : `총 ${screenSettings.length}개 표시`}</span>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-user-table admin-screen-table">
            <thead>
              <tr>
                <th>페이지</th>
                <th>종류</th>
                <th>섹션/키</th>
                <th>관리 이름</th>
                <th>설정 값</th>
                <th>상태</th>
                <th>수정일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {screenSettings.length === 0 ? (
                <tr><td colSpan="8" className="admin-empty-cell">등록된 화면 설정이 없습니다.</td></tr>
              ) : screenSettings.map((setting) => {
                const pageLabel = SCREEN_SETTING_PAGE_OPTIONS.find((option) => option.value === setting.page_key)?.label || setting.page_key;
                const typeLabel = SCREEN_SETTING_TYPE_OPTIONS.find((option) => option.value === setting.setting_type)?.label || setting.setting_type;
                return (
                  <tr key={setting.id} className={Number(setting.is_active) ? '' : 'admin-row-muted'}>
                    <td>{pageLabel}</td>
                    <td>{typeLabel}</td>
                    <td><strong>{setting.section_key}</strong><small>{setting.setting_key}</small></td>
                    <td>{setting.setting_label}</td>
                    <td className="admin-screen-value-cell">{setting.setting_value || '-'}</td>
                    <td><span className={Number(setting.is_active) ? 'admin-badge admin-badge-live' : 'admin-badge'}>{Number(setting.is_active) ? '활성' : '비활성'}</span></td>
                    <td>{formatDateTime(setting.updated_at)}</td>
                    <td>
                      <div className="admin-chip-row admin-screen-actions">
                        <button type="button" onClick={() => startEditScreenSetting(setting)}>수정</button>
                        <button type="button" onClick={() => handleToggleScreenSetting(setting.id)}>{Number(setting.is_active) ? '끄기' : '켜기'}</button>
                        <button type="button" className="danger" onClick={() => handleDeleteScreenSetting(setting.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    );
}
