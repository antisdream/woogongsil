// 회식맵 기능 모듈입니다: MealMapMapSection
import React from 'react';
import { formatPrice, getMarkerPosition, getPlaceMarkerText } from './mealMapUtils.js';

function formatMapText(mt, key, fallback, values = {}) {
    const source = typeof mt === 'function' ? mt(key) || fallback : fallback;
    return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        source,
    );
}

export default function MealMapMapSection({
    config,
    mt,
    loading,
    places,
    mapRef,
    kakaoMapCanvasRef,
    mapStatus,
    mapDebug,
    isClusterMode,
    clusterGroups,
    setZoomLevel,
    setSelectedPlace,
    selectedPlace,
    openExternalMap,
    toggleLike,
    openEditRequest,
    requestDeletePlace,
    commentsLoading,
    comments,
    commentText,
    setCommentText,
    submitComment,
}) {
    const emptyValue = mt('detailEmptyValue') || '-';
    const unknownCategory = mt('detailUnknownCategory') || '식당';

    return (
        <section className="mealmap-layout">
            <div className="mealmap-map-card">
                <div className="mealmap-map-head">
                    <div>
                        <strong>{config.mapEnabled ? mt('kakaoMapModeTitle') : mt('mapTitle')}</strong>
                        <span>
                            {loading
                                ? mt('loadingText')
                                : formatMapText(mt, 'mapCountText', `${mt('mapCountPrefix')} {count}개`, {
                                    count: places.length.toLocaleString('ko-KR'),
                                })}
                        </span>
                    </div>
                </div>

                <div className="mealmap-map-surface" ref={mapRef}>
                    {(config.mapEnabled && config.mapClientId) && (
                        <>
                            <div className="mealmap-real-map-layer" ref={kakaoMapCanvasRef} aria-label={mt('kakaoMapAriaLabel')} />
                            {mapStatus === 'loading' && (
                                <div className="mealmap-kakao-map-message">
                                    <strong>{mt('kakaoMapLoadingTitle')}</strong>
                                    <span>{mt('kakaoMapLoadingBody')}</span>
                                </div>
                            )}
                            {mapStatus === 'error' && (
                                <div className="mealmap-kakao-map-message mealmap-kakao-map-message-error">
                                    <strong>{mt('kakaoMapErrorTitle')}</strong>
                                    <span>{mapDebug || mt('kakaoMapErrorBody')}</span>
                                    <small className="mealmap-kakao-debug-hint">{mt('kakaoMapDebugHint')}</small>
                                </div>
                            )}
                        </>
                    )}
                    {(!config.mapEnabled || !config.mapClientId) && (
                        <>
                            <div className="mealmap-grid-bg" />
                            <div className="mealmap-floating-help">
                                <strong>{isClusterMode ? mt('clusterZoomOutTitle') : mt('clusterZoomInTitle')}</strong>
                                <span>{mt('mapGuideBody')}</span>
                            </div>

                            {places.length === 0 && (
                                <div className="mealmap-empty-map">
                                    <strong>{mt('emptyTitle')}</strong>
                                    <span>{mt('emptyBody')}</span>
                                </div>
                            )}

                            {isClusterMode ? clusterGroups.map((group, index) => (
                                <button
                                    type="button" key={`cluster-${index}`}
                                    className="mealmap-cluster-marker" style={{ left: group.left, top: group.top }}
                                    onClick={() => setZoomLevel(14)}
                                >
                                    {group.label}
                                </button>
                            )) : places.map((place, index) => (
                                <button
                                    type="button" key={place.id || `${place.name}-${index}`}
                                    className="mealmap-place-marker" style={getMarkerPosition(index, places.length)}
                                    onClick={() => setSelectedPlace(place)}
                                >
                                    {getPlaceMarkerText(place)}
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>

            <aside className={`mealmap-detail-panel ${selectedPlace ? 'mealmap-detail-panel-open' : ''}`}>
                {selectedPlace ? (
                    <>
                        <div className="mealmap-detail-head">
                            <div>
                                <span>{selectedPlace.category || unknownCategory}</span>
                                <h2>{selectedPlace.name}</h2>
                                <p>{selectedPlace.address || selectedPlace.road_address || emptyValue}</p>
                            </div>
                            <button type="button" onClick={() => setSelectedPlace(null)} aria-label={mt('detailCloseAria')}>{mt('closeButton')}</button>
                        </div>

                        <div className="mealmap-detail-meta">
                            <div><strong>{mt('priceLabel')}</strong><span>{formatPrice(selectedPlace.min_price)} ~ {formatPrice(selectedPlace.max_price)}</span></div>
                            <div><strong>{mt('openingHoursLabel')}</strong><span>{selectedPlace.opening_hours || emptyValue}</span></div>
                            <div><strong>{mt('mainMenuLabel')}</strong><span>{selectedPlace.main_menu || emptyValue}</span></div>
                            <div><strong>{mt('reporterLabel')}</strong><span>{selectedPlace.reporter_name || selectedPlace.reporter_id || emptyValue}</span></div>
                        </div>

                        {selectedPlace.report_note && <p className="mealmap-report-note">{selectedPlace.report_note}</p>}

                        <div className="mealmap-detail-actions">
                            <button type="button" className="mealmap-naver-btn" onClick={() => openExternalMap(selectedPlace)}>{mt('naverButton')}</button>
                            <button type="button" className={`mealmap-like-btn ${selectedPlace?.liked_by_me ? 'is-liked' : ''}`} onClick={() => toggleLike(selectedPlace)}>{mt('likeButton')} {selectedPlace.like_count || 0}</button>
                            <button type="button" className="mealmap-action" onClick={() => openEditRequest(selectedPlace)}>{mt('editSuggestButton')}</button>
                            <button type="button" className="mealmap-action mealmap-danger-action" onClick={() => requestDeletePlace(selectedPlace)}>{mt('deleteSuggestButton')}</button>
                        </div>

                        <section className="mealmap-comments">
                            <h3>{mt('commentTitle')}</h3>
                            {commentsLoading ? <p>{mt('commentLoadingText')}</p> : comments.length === 0 ? <p>{mt('commentEmptyText')}</p> : (
                                <div className="mealmap-comment-list">
                                    {comments.map((comment) => (
                                        <article key={comment.id}>
                                            <strong>{comment.user_name || comment.user_id}</strong>
                                            <p>{comment.comment_text}</p>
                                            <span>{comment.created_at ? new Date(comment.created_at).toLocaleString('ko-KR') : ''}</span>
                                        </article>
                                    ))}
                                </div>
                            )}
                            <div className="mealmap-comment-form">
                                <input
                                    value={commentText}
                                    onChange={(event) => setCommentText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            submitComment();
                                        }
                                    }}
                                    placeholder={mt('commentPlaceholder')}
                                />
                                <button type="button" onClick={submitComment}>{mt('commentSubmitButton')}</button>
                            </div>
                        </section>
                    </>
                ) : (
                    <div className="mealmap-detail-empty">
                        <strong>{mt('selectMarkerTitle')}</strong>
                        <span>{mt('selectMarkerBody')}</span>
                    </div>
                )}
            </aside>
        </section>
    );
}
