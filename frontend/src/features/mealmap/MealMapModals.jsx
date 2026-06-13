// 회식맵 기능 모듈입니다: MealMapModals
import React from 'react';
import {
    MEAL_CATEGORIES,
    PRICE_MAX,
    PRICE_MIN,
    PRICE_STEP,
    formatMealMapDateTime,
    formatPrice,
    getMealMapActivityStatusLabel,
    getMealMapActivityTypeLabel,
} from './mealMapUtils.js';

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
}) {
    if (!open) return null;

    return (
        <div className="mealmap-modal-backdrop mealmap-activity-backdrop" role="presentation" onClick={closeMealMapModal}>
            <div className="mealmap-modal mealmap-activity-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="mealmap-modal-head mealmap-activity-head">
                    <div>
                        <p className="mealmap-kicker">회식맵 활동 이력</p>
                        <h2>제보/수정 제안 처리 내역</h2>
                        <p>승인 대기, 승인 완료, 반려 상태를 확인하고 반려된 요청은 이전 입력 내용으로 다시 제출할 수 있습니다.</p>
                    </div>
                    <button type="button" onClick={closeMealMapModal}>닫기</button>
                </div>

                {activityLoading ? (
                    <div className="mealmap-activity-empty">활동 이력을 불러오는 중입니다.</div>
                ) : activityItems.length === 0 ? (
                    <div className="mealmap-activity-empty">아직 등록된 회식맵 제보/수정 제안 이력이 없습니다.</div>
                ) : (
                    <div className="mealmap-activity-table-wrap">
                        <table className="mealmap-activity-table">
                            <thead>
                                <tr>
                                    <th>No</th>
                                    <th>유형</th>
                                    <th>상태</th>
                                    <th>식당명</th>
                                    <th>주소</th>
                                    <th>가격</th>
                                    <th>운영시간</th>
                                    <th>대표메뉴</th>
                                    <th>요청일시</th>
                                    <th>처리일시</th>
                                    <th>처리 결과</th>
                                    <th>상세/다시 요청</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activityItems.map((item, index) => (
                                    <tr key={item.id || `${item.type}-${item.requestId}-${index}`}>
                                        <td>{(activityPage - 1) * 20 + index + 1}</td>
                                        <td>{getMealMapActivityTypeLabel(item.type)}</td>
                                        <td><span className={`mealmap-activity-status mealmap-activity-status-${item.status || 'pending'}`}>{getMealMapActivityStatusLabel(item.status)}</span></td>
                                        <td>{item.placeName || '-'}</td>
                                        <td>{item.address || item.roadAddress || '-'}</td>
                                        <td>{formatPrice(item.minPrice)} ~ {formatPrice(item.maxPrice)}</td>
                                        <td>{item.openingHours || '-'}</td>
                                        <td>{item.mainMenu || '-'}</td>
                                        <td>{formatMealMapDateTime(item.requestedAt)}</td>
                                        <td>{formatMealMapDateTime(item.processedAt)}</td>
                                        <td>{item.adminNote || getMealMapActivityStatusLabel(item.status)}</td>
                                        <td>
                                            {item.status === 'rejected'? (
                                                <button type="button" className="mealmap-activity-resubmit" onClick={() => handleActivityResubmit(item)}>
                                                    {item.type === 'edit'? '다시 수정 제안' : '다시 제보하기'}
                                                </button>
                                            ) : (
                                                <span className="mealmap-activity-muted">상세 확인</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="mealmap-activity-footer">
                    <span>전체 {activityTotal.toLocaleString('ko-KR')}건</span>
                    <div className="mealmap-activity-pager">
                        <button type="button" disabled={activityPage <= 1 || activityLoading} onClick={() => fetchActivityHistory(activityPage - 1)}>이전</button>
                        <strong>{activityPage} / {activityTotalPages}</strong>
                        <button type="button" disabled={activityPage >= activityTotalPages || activityLoading} onClick={() => fetchActivityHistory(activityPage + 1)}>다음</button>
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
}) {
    if (!open) return null;

    return (
        <div className="mealmap-modal-backdrop" onClick={closeMealMapModal} role="presentation">
            <div className="mealmap-modal mealmap-filter-modal" onClick={(event) => event.stopPropagation()}>
                <div className="mealmap-modal-head">
                    <h2>상세 필터 설정</h2>
                    <button type="button" onClick={closeMealMapModal}>닫기</button>
                </div>
                <label className="mealmap-range-label">
                    <span>최소 예산</span>
                    <strong>{formatPrice(draftFilters.minPrice)}</strong>
                    <input type="range" min={PRICE_MIN} max={PRICE_MAX} step={PRICE_STEP} value={draftFilters.minPrice} onChange={(event) => setDraftFilters((prev) => ({ ...prev, minPrice: Number(event.target.value) }))} />
                </label>
                <label className="mealmap-range-label">
                    <span>최대 예산</span>
                    <strong>{formatPrice(draftFilters.maxPrice)}</strong>
                    <input type="range" min={PRICE_MIN} max={PRICE_MAX} step={PRICE_STEP} value={draftFilters.maxPrice} onChange={(event) => setDraftFilters((prev) => ({ ...prev, maxPrice: Number(event.target.value) }))} />
                </label>
                <div className="mealmap-category-grid">
                    {MEAL_CATEGORIES.map((category) => (
                        <button
                            type="button" key={category}
                            className={draftFilters.categories.includes(category) ? 'mealmap-chip-active' : ''}
                            onClick={() => toggleDraftCategory(category)}
                        >
                            {category}
                        </button>
                    ))}
                </div>
                <div className="mealmap-modal-actions">
                    <button type="button" onClick={resetFilters}>초기화</button>
                    <button type="button" className="mealmap-primary-btn" onClick={applyFilters}>적용</button>
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
                    <h2>장소 제보하기</h2>
                    <button type="button" onClick={closeMealMapModal}>닫기</button>
                </div>
                {!isLoggedIn && <p className="mealmap-api-note">로그인 후 제보할 수 있습니다.</p>}
                <div className="mealmap-form-grid">
                    <label><span>식당명 *</span><input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
                    <label><span>카테고리</span><select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>{MEAL_CATEGORIES.filter((item) => item !== '전체').map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                    <label className="mealmap-form-wide">
                        <span>주소 *</span>
                        <div className="mealmap-address-lookup-row">
                            <input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} />
                            <button type="button" onClick={fillFormCoordinates} disabled={geocoding || !form.address.trim()}>
                                {geocoding ? '좌표 찾는 중...' : '주소로 좌표 찾기'}
                            </button>
                        </div>
                    </label>
                    <label className="full mealmap-form-wide mealmap-keyword-lookup">카카오 장소 키워드 검색
                        <div className="mealmap-lookup-row">
                            <input
                                value={formLookupKeyword}
                                onChange={(event) => setFormLookupKeyword(event.target.value)}
                                placeholder="예: 동남집 독산점, 가산디지털단지역 국밥"
                            />
                            <button type="button" onClick={() => lookupPlaceKeyword('form')} disabled={formLookupSearching}>
                                {formLookupSearching ? '검색 중...' : '키워드로 좌표 찾기'}
                            </button>
                        </div>
                        {formLookupResults.length >0 && (
                            <div className="mealmap-lookup-results">
                                {formLookupResults.map((item, index) => (
                                    <button
                                        type="button" key={`${item.name || 'place'}-${index}`}
                                        className="mealmap-lookup-result" onClick={() => applyLookupResult('form', item)}
                                    >
                                        <strong>{item.name || '이름 없음'}</strong>
                                        <span>{item.roadAddress || item.address || '주소 정보 없음'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </label>
                    <label><span>최소가격</span><input type="number" step="1000" min="0" value={form.minPrice} onChange={(event) => setForm((prev) => ({ ...prev, minPrice: event.target.value }))} /></label>
                    <label><span>최대가격</span><input type="number" step="1000" min="0" value={form.maxPrice} onChange={(event) => setForm((prev) => ({ ...prev, maxPrice: event.target.value }))} /></label>
                    <label><span>대표메뉴</span><input value={form.mainMenu} onChange={(event) => setForm((prev) => ({ ...prev, mainMenu: event.target.value }))} /></label>
                    <label><span>영업시간</span><input value={form.openingHours} onChange={(event) => setForm((prev) => ({ ...prev, openingHours: event.target.value }))} placeholder="예: 09:00 - 22:00" /></label>
                    <label><span>위도</span><input value={form.lat} onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))} placeholder="선택" /></label>
                    <label><span>경도</span><input value={form.lng} onChange={(event) => setForm((prev) => ({ ...prev, lng: event.target.value }))} placeholder="선택" /></label>
                    <label className="mealmap-form-wide"><span>카카오맵/후기 링크</span><input value={form.naverUrl} onChange={(event) => setForm((prev) => ({ ...prev, naverUrl: event.target.value }))} /></label>
                    <label className="mealmap-form-wide"><span>제보 메모</span><textarea value={form.reportNote} onChange={(event) => setForm((prev) => ({ ...prev, reportNote: event.target.value }))} rows={4} /></label>
                </div>
                <div className="mealmap-modal-actions">
                    <button type="button" onClick={closeMealMapModal}>{mt('editCancelButton')}</button>
                    <button type="submit" className="mealmap-primary-btn" disabled={submitting || !isLoggedIn}>{submitting ? '접수 중...' : '관리자 승인 요청'}</button>
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
                        <p className="mealmap-kicker">{mt('editModalEyebrow')}</p>
                        <h2>{editPlace.name} 정보 수정 요청</h2>
                        <p>{mt('editModalSubtext')}</p>
                    </div>
                    <button type="button" onClick={closeMealMapModal}>닫기</button>
                </div>

                <label>
                    {mt('editReasonLabel')}
                    <textarea
                        value={editForm.reason}
                        onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })}
                        placeholder={mt('editReasonPlaceholder')}
                        rows="3"
                    />
                </label>

                <div className="mealmap-form-grid two">
                    <label>
                        식당명
                        <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required />
                    </label>
                    <label>
                        카테고리
                        <select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                            {MEAL_CATEGORIES.filter((category) => category !== '전체').map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                    </label>
                    <label>
                        최소 가격
                        <input type="number" step="1000" min="0" value={editForm.minPrice} onChange={(event) => setEditForm({ ...editForm, minPrice: event.target.value })} />
                    </label>
                    <label>
                        최대 가격
                        <input type="number" step="1000" min="0" value={editForm.maxPrice} onChange={(event) => setEditForm({ ...editForm, maxPrice: event.target.value })} />
                    </label>
                </div>

                <label>
                    주소
                    <div className="mealmap-address-lookup-row">
                        <input value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} required />
                        <button type="button" onClick={fillEditCoordinates} disabled={editGeocoding || !String(editForm.address || '').trim()}>
                            {editGeocoding ? '좌표 찾는 중...' : '주소로 좌표 찾기'}
                        </button>
                    </div>
                </label>
                <label className="full mealmap-form-wide mealmap-keyword-lookup">카카오 장소 키워드 검색
                    <div className="mealmap-lookup-row">
                        <input
                            value={editLookupKeyword}
                            onChange={(event) => setEditLookupKeyword(event.target.value)}
                            placeholder="예: 동남집 독산점, 가산디지털단지역 국밥"
                        />
                        <button type="button" onClick={() => lookupPlaceKeyword('edit')} disabled={editLookupSearching}>
                            {editLookupSearching ? '검색 중...' : '키워드로 좌표 찾기'}
                        </button>
                    </div>
                    {editLookupResults.length >0 && (
                        <div className="mealmap-lookup-results">
                            {editLookupResults.map((item, index) => (
                                <button
                                    type="button" key={`${item.name || 'place'}-${index}`}
                                    className="mealmap-lookup-result" onClick={() => applyLookupResult('edit', item)}
                                >
                                    <strong>{item.name || '이름 없음'}</strong>
                                    <span>{item.roadAddress || item.address || '주소 정보 없음'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </label>

                <div className="mealmap-form-grid two">
                    <label>
                        위도
                        <input type="number" step="0.000001" value={editForm.lat} onChange={(event) => setEditForm({ ...editForm, lat: event.target.value })} />
                    </label>
                    <label>
                        경도
                        <input type="number" step="0.000001" value={editForm.lng} onChange={(event) => setEditForm({ ...editForm, lng: event.target.value })} />
                    </label>
                </div>

                <label>
                    대표 메뉴
                    <input value={editForm.mainMenu} onChange={(event) => setEditForm({ ...editForm, mainMenu: event.target.value })} />
                </label>
                <label>
                    영업시간
                    <input value={editForm.openingHours} onChange={(event) => setEditForm({ ...editForm, openingHours: event.target.value })} />
                </label>
                <label>
                    카카오맵/후기 링크
                    <input value={editForm.naverUrl} onChange={(event) => setEditForm({ ...editForm, naverUrl: event.target.value })} />
                </label>

                <div className="mealmap-modal-actions">
                    <button type="button" onClick={closeMealMapModal}>{mt('editCancelButton')}</button>
                    <button type="submit" disabled={editLoading}>{editLoading ? '접수 중...' : mt('editSubmitButton')}</button>
                </div>
            </form>
        </div>
    );
}
