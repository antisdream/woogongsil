// 관리자 기능 모듈입니다: AdminMealMapSettingsSection
import React from 'react';
import {
    MEALMAP_TEXT_FIELD_META,
    mealMapLayoutFieldsV253,
} from '../adminUtils.js';

export default function AdminMealMapSettingsSection({
    loadMealMapLayoutsV253,
    saveMealMapLayoutSettingsV253,
    mealMapLayoutsV253,
    setMealMapLayoutsV253,
    loadMealMapTextSettings,
    saveMealMapTextSettings,
    mealMapTextLoading,
    mealMapTextSaving,
    mealMapTextSettings,
    updateMealMapTextSetting,
}) {
    return (
        <>
    <div className="admin-card mealmap-admin-card" style={{ marginTop: 16 }}>
      <div className="admin-section-title-row">
        <div>
          <h3>회식맵 레이아웃 관리</h3>
          <p>지도 영역 높이, 최대 폭, 카드 간격 등 회식맵 화면 구성을 조정합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-btn" type="button" onClick={loadMealMapLayoutsV253}>
            레이아웃 새로고침
          </button>
          <button className="admin-btn primary" type="button" onClick={saveMealMapLayoutSettingsV253}>
            레이아웃 저장
          </button>
        </div>
      </div>
      <div className="mealmap-text-settings-grid">
        {mealMapLayoutFieldsV253.map((field) => (
          <label key={field.key} className="mealmap-text-setting-field">
            <span>{field.label}</span>
            <input
              value={mealMapLayoutsV253[field.key] ?? ''}
              onChange={(e) => setMealMapLayoutsV253((prev) => ({
                  ...prev,
                  [field.key]: e.target.value,
                }))
              }
              placeholder={field.hint}
            />
            <small>{field.key}</small>
          </label>
        ))}
      </div>
    </div>

    <div className="admin-card mealmap-admin-card" style={{ marginTop: 16 }}>
      <div className="admin-section-title-row">
        <div>
          <h3>회식맵 문구 관리</h3>
          <p>회식맵 페이지의 제목, 설명, 버튼명, 안내문을 관리자 페이지에서 직접 수정합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-btn" type="button" onClick={loadMealMapTextSettings} disabled={mealMapTextLoading}>
            {mealMapTextLoading ? '불러오는 중...' : '문구 새로고침'}
          </button>
          <button className="admin-btn primary" type="button" onClick={saveMealMapTextSettings} disabled={mealMapTextSaving}>
            {mealMapTextSaving ? '저장 중...' : '문구 저장'}
          </button>
        </div>
      </div>
      <div className="mealmap-text-settings-grid">
        {MEALMAP_TEXT_FIELD_META.map((field) => (
          <label key={field.key} className="mealmap-text-setting-field">
            <span>{field.label}</span>
            <input
              value={mealMapTextSettings[field.key] || ''}
              onChange={(e) => updateMealMapTextSetting(field.key, e.target.value)}
              placeholder={field.label}
            />
          </label>
        ))}
      </div>
    </div>
        </>
    );
}
