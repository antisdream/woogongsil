import React from 'react';
import {
    MEAL_CATEGORIES,
    PRICE_MAX,
    PRICE_MIN,
    PRICE_STEP,
    formatMealMapDateTime,
    formatPrice,
} from './mealMapUtils.js';

function modalText(mt, key, fallback = '') {
    if (typeof mt !== 'function') return fallback;
    return mt(key) || fallback;
}

function formatModalText(mt, key, fallback, values = {}) {
    return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        modalText(mt, key, fallback),
    );
}

function activityTypeLabel(mt, type) {
    if (type === 'edit') return modalText(mt, 'activityTypeEdit', '수정 제안');
    return modalText(mt, 'activityTypeReport', '장소 제보');
}

function activityStatusLabel(mt, status) {
    if (status === 'approved') return modalText(mt, 'activityStatusApproved', '승인 완료');
    if (status === 'rejected') return modalText(mt, 'activityStatusRejected', '반려');
    if (status === 'hidden') return modalText(mt, 'activityStatusHidden', '숨김');
    return modalText(mt, 'activityStatusPending', '승인 대기');
}

const editableMealCategories = MEAL_CATEGORIES.filter((_, index) => index !== 0);
const categorySuggestionLabels = Array.from(new Set([
    ...editableMealCategories,
    '한정식',
    '분식',
    '일식',
    '양식',
    '고기/구이',
    '족발/보쌈',
    '회/초밥',
    '샐러드',
    '디저트',
]));
const koreanInitials = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function getKoreanInitialText(value = '') {
    return String(value).split('').map((char) => {
        const code = char.charCodeAt(0) - 44032;
        if (code < 0 || code > 11171) return char;
        return koreanInitials[Math.floor(code / 588)] || char;
    }).join('');
}

function getCategorySuggestions(value) {
    const keyword = String(value || '').trim();
    if (!keyword) return [];

    return categorySuggestionLabels
        .filter((category) => {
            const label = String(category);
            const initials = getKoreanInitialText(label);
            return label.includes(keyword) || initials.includes(keyword);
        })
        .slice(0, 8);
}

function MealMapCategoryInput({ label, value, onChange }) {
    const suggestions = getCategorySuggestions(value);

    return (
        <label className="mealmap-category-field">
            <span>{label}</span>
            <input
                value={value || ''}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="off"
            />
            {suggestions.length > 0 && (
                <div className="mealmap-category-suggestions">
                    {suggestions.map((category) => (
                        <button
                            type="button"
                            key={category}
                            onClick={() => onChange(category)}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            )}
        </label>
    );
}

export function MealMapActivityModal({
    open,
    closeMealMapModal,
    activityLoading,
    activityItems,
    activityPage,
    activityTotal,
    activityTotalPages,
    fetchActivityHistory,
    handleActivityResubmit,
    mt,
}) {
    if (!open) return null;

    return (
        <div className="mealmap-modal-backdrop mealmap-activity-backdrop" role="presentation" onClick={closeMealMapModal}>
            <div className="mealmap-modal mealmap-activity-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="mealmap-modal-head mealmap-activity-head">
                    <div>
                        <p className="mealmap-kicker">{modalText(mt, 'activityModalEyebrow', '회식맵 활동 이력')}</p>
                        <h2>{modalText(mt, 'activityModalTitle', '제보/수정 제안 처리 내역')}</h2>
                        <p>{modalText(mt, 'activityModalSubtext', '승인 대기, 승인 완료, 반려 상태를 확인하고 반려된 요청은 이전 입력 내용으로 다시 제출할 수 있습니다.')}</p>
                    </div>
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'closeButton', '닫기')}</button>
                </div>

                {activityLoading ? (
                    <div className="mealmap-activity-empty">{modalText(mt, 'activityLoadingText', '활동 이력을 불러오는 중입니다.')}</div>
                ) : activityItems.length === 0 ? (
                    <div className="mealmap-activity-empty">{modalText(mt, 'activityEmptyText', '아직 등록된 회식맵 제보/수정 제안 이력이 없습니다.')}</div>
                ) : (
                    <div className="mealmap-activity-table-wrap">
                        <table className="mealmap-activity-table">
                            <thead>
                                <tr>
                                    <th>{modalText(mt, 'activityColumnNo', 'No')}</th>
                                    <th>{modalText(mt, 'activityColumnType', '유형')}</th>
                                    <th>{modalText(mt, 'activityColumnStatus', '상태')}</th>
                                    <th>{modalText(mt, 'activityColumnPlaceName', '식당명')}</th>
                                    <th>{modalText(mt, 'activityColumnAddress', '주소')}</th>
                                    <th>{modalText(mt, 'activityColumnPrice', '가격')}</th>
                                    <th>{modalText(mt, 'activityColumnOpeningHours', '운영시간')}</th>
                                    <th>{modalText(mt, 'activityColumnMainMenu', '대표메뉴')}</th>
                                    <th>{modalText(mt, 'activityColumnRequestedAt', '요청일시')}</th>
                                    <th>{modalText(mt, 'activityColumnProcessedAt', '처리일시')}</th>
                                    <th>{modalText(mt, 'activityColumnResult', '처리 결과')}</th>
                                    <th>{modalText(mt, 'activityColumnAction', '상세/다시 요청')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activityItems.map((item, index) => (
                                    <tr key={item.id || `${item.type}-${item.requestId}-${index}`}>
                                        <td>{(activityPage - 1) * 20 + index + 1}</td>
                                        <td>{activityTypeLabel(mt, item.type)}</td>
                                        <td>
                                            <span className={`mealmap-activity-status mealmap-activity-status-${item.status || 'pending'}`}>
                                                {activityStatusLabel(mt, item.status)}
                                            </span>
                                        </td>
                                        <td>{item.placeName || '-'}</td>
                                        <td>{item.address || item.roadAddress || '-'}</td>
                                        <td>{formatPrice(item.minPrice)} ~ {formatPrice(item.maxPrice)}</td>
                                        <td>{item.openingHours || '-'}</td>
                                        <td>{item.mainMenu || '-'}</td>
                                        <td>{formatMealMapDateTime(item.requestedAt)}</td>
                                        <td>{formatMealMapDateTime(item.processedAt)}</td>
                                        <td>{item.adminNote || activityStatusLabel(mt, item.status)}</td>
                                        <td>
                                            {item.status === 'rejected' ? (
                                                <button type="button" className="mealmap-activity-resubmit" onClick={() => handleActivityResubmit(item)}>
                                                    {item.type === 'edit'
                                                        ? modalText(mt, 'activityResubmitEditButton', '다시 수정 제안')
                                                        : modalText(mt, 'activityResubmitReportButton', '다시 제보하기')}
                                                </button>
                                            ) : (
                                                <span className="mealmap-activity-muted">{modalText(mt, 'activityDetailText', '상세 확인')}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="mealmap-activity-footer">
                    <span>
                        {formatModalText(mt, 'activityTotalText', '전체 {count}건', {
                            count: activityTotal.toLocaleString('ko-KR'),
                        })}
                    </span>
                    <div className="mealmap-activity-pager">
                        <button type="button" disabled={activityPage <= 1 || activityLoading} onClick={() => fetchActivityHistory(activityPage - 1)}>
                            {modalText(mt, 'activityPrevButton', '이전')}
                        </button>
                        <strong>{activityPage} / {activityTotalPages}</strong>
                        <button type="button" disabled={activityPage >= activityTotalPages || activityLoading} onClick={() => fetchActivityHistory(activityPage + 1)}>
                            {modalText(mt, 'activityNextButton', '다음')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function MealMapFilterModal({
    open,
    closeMealMapModal,
    draftFilters,
    setDraftFilters,
    toggleDraftCategory,
    resetFilters,
    applyFilters,
    mt,
}) {
    if (!open) return null;

    return (
        <div className="mealmap-modal-backdrop" onClick={closeMealMapModal} role="presentation">
            <div className="mealmap-modal mealmap-filter-modal" onClick={(event) => event.stopPropagation()}>
                <div className="mealmap-modal-head">
                    <h2>{modalText(mt, 'filterModalTitle', '상세 필터 설정')}</h2>
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'closeButton', '닫기')}</button>
                </div>
                <label className="mealmap-range-label">
                    <span>{modalText(mt, 'filterMinBudgetLabel', '최소 예산')}</span>
                    <strong>{formatPrice(draftFilters.minPrice)}</strong>
                    <input type="range" min={PRICE_MIN} max={PRICE_MAX} step={PRICE_STEP} value={draftFilters.minPrice} onChange={(event) => setDraftFilters((prev) => ({ ...prev, minPrice: Number(event.target.value) }))} />
                </label>
                <label className="mealmap-range-label">
                    <span>{modalText(mt, 'filterMaxBudgetLabel', '최대 예산')}</span>
                    <strong>{formatPrice(draftFilters.maxPrice)}</strong>
                    <input type="range" min={PRICE_MIN} max={PRICE_MAX} step={PRICE_STEP} value={draftFilters.maxPrice} onChange={(event) => setDraftFilters((prev) => ({ ...prev, maxPrice: Number(event.target.value) }))} />
                </label>
                <div className="mealmap-category-grid">
                    {MEAL_CATEGORIES.map((category) => (
                        <button
                            type="button"
                            key={category}
                            className={draftFilters.categories.includes(category) ? 'mealmap-chip-active' : ''}
                            onClick={() => toggleDraftCategory(category)}
                        >
                            {category}
                        </button>
                    ))}
                </div>
                <div className="mealmap-modal-actions">
                    <button type="button" onClick={resetFilters}>{modalText(mt, 'filterResetButton', '초기화')}</button>
                    <button type="button" className="mealmap-primary-btn" onClick={applyFilters}>{modalText(mt, 'filterApplyButton', '적용')}</button>
                </div>
            </div>
        </div>
    );
}

export function MealMapAddModal({
    open,
    submitPlace,
    closeMealMapModal,
    isLoggedIn,
    form,
    setForm,
    fillFormCoordinates,
    geocoding,
    formLookupKeyword,
    setFormLookupKeyword,
    lookupPlaceKeyword,
    formLookupSearching,
    formLookupResults,
    applyLookupResult,
    submitting,
    mt,
}) {
    if (!open) return null;

    return (
        <div className="mealmap-modal-backdrop" role="presentation">
            <form className="mealmap-modal mealmap-add-modal" onSubmit={submitPlace} noValidate onClick={(event) => event.stopPropagation()}>
                <div className="mealmap-modal-head">
                    <h2>{modalText(mt, 'addModalTitle', '장소 제보하기')}</h2>
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'closeButton', '닫기')}</button>
                </div>
                {!isLoggedIn && <p className="mealmap-api-note">{modalText(mt, 'loginRequiredText', '로그인 후 제보할 수 있습니다.')}</p>}
                <div className="mealmap-form-grid">
                    <label>
                        <span>{modalText(mt, 'formNameLabel', '식당명 *')}</span>
                        <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
                    </label>
                    <MealMapCategoryInput
                        label={modalText(mt, 'formCategoryLabel', '카테고리')}
                        value={form.category}
                        onChange={(category) => setForm((prev) => ({ ...prev, category }))}
                    />
                    <label className="mealmap-form-wide">
                        <span>{modalText(mt, 'formAddressLabel', '주소 *')}</span>
                        <div className="mealmap-address-lookup-row">
                            <input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} />
                            <button type="button" onClick={fillFormCoordinates} disabled={geocoding || !form.address.trim()}>
                                {geocoding ? modalText(mt, 'formGeocodingText', '좌표 찾는 중...') : modalText(mt, 'formGeocodeButton', '주소로 좌표 찾기')}
                            </button>
                        </div>
                    </label>
                    <label className="full mealmap-form-wide mealmap-keyword-lookup">
                        <span>{modalText(mt, 'formKeywordSearchLabel', '카카오 장소 키워드 검색')}</span>
                        <div className="mealmap-lookup-row">
                            <input
                                value={formLookupKeyword}
                                onChange={(event) => setFormLookupKeyword(event.target.value)}
                                placeholder={modalText(mt, 'formKeywordPlaceholder', '예: 동남집 독산점, 가산디지털단지역 국밥')}
                            />
                            <button type="button" onClick={() => lookupPlaceKeyword('form')} disabled={formLookupSearching}>
                                {formLookupSearching ? modalText(mt, 'formLookupSearchingText', '검색 중...') : modalText(mt, 'formLookupButton', '키워드로 좌표 찾기')}
                            </button>
                        </div>
                        {formLookupResults.length > 0 && (
                            <div className="mealmap-lookup-results">
                                {formLookupResults.map((item, index) => (
                                    <button
                                        type="button"
                                        key={`${item.name || 'place'}-${index}`}
                                        className="mealmap-lookup-result"
                                        onClick={() => applyLookupResult('form', item)}
                                    >
                                        <strong>{item.name || modalText(mt, 'formLookupEmptyName', '이름 없음')}</strong>
                                        <span>{item.roadAddress || item.address || modalText(mt, 'formLookupEmptyAddress', '주소 정보 없음')}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </label>
                    <label>
                        <span>{modalText(mt, 'formMinPriceLabel', '최소가격')}</span>
                        <input type="number" step="1000" min="0" value={form.minPrice} onChange={(event) => setForm((prev) => ({ ...prev, minPrice: event.target.value }))} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'formMaxPriceLabel', '최대가격')}</span>
                        <input type="number" step="1000" min="0" value={form.maxPrice} onChange={(event) => setForm((prev) => ({ ...prev, maxPrice: event.target.value }))} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'formMainMenuLabel', '대표메뉴')}</span>
                        <input value={form.mainMenu} onChange={(event) => setForm((prev) => ({ ...prev, mainMenu: event.target.value }))} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'formOpeningHoursLabel', '영업시간')}</span>
                        <input
                            value={form.openingHours}
                            onChange={(event) => setForm((prev) => ({ ...prev, openingHours: event.target.value }))}
                            placeholder={modalText(mt, 'formOpeningHoursPlaceholder', '예: 09:00 - 22:00')}
                        />
                    </label>
                    <label>
                        <span>{modalText(mt, 'formLatitudeLabel', '위도')}</span>
                        <input value={form.lat} onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))} placeholder={modalText(mt, 'formCoordinatePlaceholder', '선택')} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'formLongitudeLabel', '경도')}</span>
                        <input value={form.lng} onChange={(event) => setForm((prev) => ({ ...prev, lng: event.target.value }))} placeholder={modalText(mt, 'formCoordinatePlaceholder', '선택')} />
                    </label>
                    <label className="mealmap-form-wide">
                        <span>{modalText(mt, 'formMapUrlLabel', '카카오맵/후기 링크')}</span>
                        <input value={form.naverUrl} onChange={(event) => setForm((prev) => ({ ...prev, naverUrl: event.target.value }))} />
                    </label>
                    <label className="mealmap-form-wide">
                        <span>{modalText(mt, 'formReportNoteLabel', '제보 메모')}</span>
                        <textarea value={form.reportNote} onChange={(event) => setForm((prev) => ({ ...prev, reportNote: event.target.value }))} rows={4} />
                    </label>
                </div>
                <div className="mealmap-modal-actions">
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'editCancelButton', '취소')}</button>
                    <button type="submit" className="mealmap-primary-btn" disabled={submitting || !isLoggedIn}>
                        {submitting ? modalText(mt, 'formSubmitLoadingText', '접수 중...') : modalText(mt, 'addSubmitButton', '바로 등록하기')}
                    </button>
                </div>
            </form>
        </div>
    );
}

export function MealMapEditModal({
    open,
    editPlace,
    editForm,
    setEditForm,
    submitEditRequest,
    closeMealMapModal,
    editLoading,
    mt,
    fillEditCoordinates,
    editGeocoding,
    editLookupKeyword,
    setEditLookupKeyword,
    lookupPlaceKeyword,
    editLookupSearching,
    editLookupResults,
    applyLookupResult,
}) {
    if (!open || !editPlace) return null;

    return (
        <div className="mealmap-modal-backdrop">
            <form className="mealmap-modal mealmap-edit-modal" onClick={(event) => event.stopPropagation()} onSubmit={submitEditRequest} noValidate>
                <div className="mealmap-modal-head">
                    <div>
                        <p className="mealmap-kicker">{modalText(mt, 'editModalEyebrow', '사용자 수정 제안')}</p>
                        <h2>{formatModalText(mt, 'editModalTitle', '{name} 정보 수정 요청', { name: editPlace.name })}</h2>
                        <p>{modalText(mt, 'editModalSubtext', '관리자 승인 후 회식맵에 반영됩니다.')}</p>
                    </div>
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'closeButton', '닫기')}</button>
                </div>

                <label>
                    <span>{modalText(mt, 'editReasonLabel', '수정 이유')}</span>
                    <textarea
                        value={editForm.reason}
                        onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })}
                        placeholder={modalText(mt, 'editReasonPlaceholder', '예: 가격 변경, 영업시간 변경, 주소 오기재 등')}
                        rows="3"
                    />
                </label>

                <div className="mealmap-form-grid two">
                    <label>
                        <span>{modalText(mt, 'editNameLabel', '식당명')}</span>
                        <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required />
                    </label>
                    <MealMapCategoryInput
                        label={modalText(mt, 'editCategoryLabel', '카테고리')}
                        value={editForm.category}
                        onChange={(category) => setEditForm({ ...editForm, category })}
                    />
                    <label>
                        <span>{modalText(mt, 'editMinPriceLabel', '최소 가격')}</span>
                        <input type="number" step="1000" min="0" value={editForm.minPrice} onChange={(event) => setEditForm({ ...editForm, minPrice: event.target.value })} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'editMaxPriceLabel', '최대 가격')}</span>
                        <input type="number" step="1000" min="0" value={editForm.maxPrice} onChange={(event) => setEditForm({ ...editForm, maxPrice: event.target.value })} />
                    </label>
                </div>

                <label>
                    <span>{modalText(mt, 'editAddressLabel', '주소')}</span>
                    <div className="mealmap-address-lookup-row">
                        <input value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} required />
                        <button type="button" onClick={fillEditCoordinates} disabled={editGeocoding || !String(editForm.address || '').trim()}>
                            {editGeocoding ? modalText(mt, 'formGeocodingText', '좌표 찾는 중...') : modalText(mt, 'formGeocodeButton', '주소로 좌표 찾기')}
                        </button>
                    </div>
                </label>
                <label className="full mealmap-form-wide mealmap-keyword-lookup">
                    <span>{modalText(mt, 'editKeywordSearchLabel', '카카오 장소 키워드 검색')}</span>
                    <div className="mealmap-lookup-row">
                        <input
                            value={editLookupKeyword}
                            onChange={(event) => setEditLookupKeyword(event.target.value)}
                            placeholder={modalText(mt, 'editKeywordPlaceholder', '예: 동남집 독산점, 가산디지털단지역 국밥')}
                        />
                        <button type="button" onClick={() => lookupPlaceKeyword('edit')} disabled={editLookupSearching}>
                            {editLookupSearching ? modalText(mt, 'formLookupSearchingText', '검색 중...') : modalText(mt, 'formLookupButton', '키워드로 좌표 찾기')}
                        </button>
                    </div>
                    {editLookupResults.length > 0 && (
                        <div className="mealmap-lookup-results">
                            {editLookupResults.map((item, index) => (
                                <button
                                    type="button"
                                    key={`${item.name || 'place'}-${index}`}
                                    className="mealmap-lookup-result"
                                    onClick={() => applyLookupResult('edit', item)}
                                >
                                    <strong>{item.name || modalText(mt, 'formLookupEmptyName', '이름 없음')}</strong>
                                    <span>{item.roadAddress || item.address || modalText(mt, 'formLookupEmptyAddress', '주소 정보 없음')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </label>

                <div className="mealmap-form-grid two">
                    <label>
                        <span>{modalText(mt, 'editLatitudeLabel', '위도')}</span>
                        <input type="number" step="0.000001" value={editForm.lat} onChange={(event) => setEditForm({ ...editForm, lat: event.target.value })} />
                    </label>
                    <label>
                        <span>{modalText(mt, 'editLongitudeLabel', '경도')}</span>
                        <input type="number" step="0.000001" value={editForm.lng} onChange={(event) => setEditForm({ ...editForm, lng: event.target.value })} />
                    </label>
                </div>

                <label>
                    <span>{modalText(mt, 'editMainMenuLabel', '대표 메뉴')}</span>
                    <input value={editForm.mainMenu} onChange={(event) => setEditForm({ ...editForm, mainMenu: event.target.value })} />
                </label>
                <label>
                    <span>{modalText(mt, 'editOpeningHoursLabel', '영업시간')}</span>
                    <input value={editForm.openingHours} onChange={(event) => setEditForm({ ...editForm, openingHours: event.target.value })} />
                </label>
                <label>
                    <span>{modalText(mt, 'editMapUrlLabel', '카카오맵/후기 링크')}</span>
                    <input value={editForm.naverUrl} onChange={(event) => setEditForm({ ...editForm, naverUrl: event.target.value })} />
                </label>

                <div className="mealmap-modal-actions">
                    <button type="button" onClick={closeMealMapModal}>{modalText(mt, 'editCancelButton', '취소')}</button>
                    <button type="submit" disabled={editLoading}>
                        {editLoading ? modalText(mt, 'editSubmitLoadingText', '접수 중...') : modalText(mt, 'editSubmitButton', '수정 제안 보내기')}
                    </button>
                </div>
            </form>
        </div>
    );
}
