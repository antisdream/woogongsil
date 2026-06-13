// 회식맵 기능 모듈입니다: MealMapMapSection
import React from 'react';
import { formatPrice, getMarkerPosition, getPlaceMarkerText } from './mealMapUtils.js';

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
    openActivityHistory,
    commentsLoading,
    comments,
    commentText,
    setCommentText,
    submitComment,
}) {
    return (
        <section className="mealmap-layout">
            <div className="mealmap-map-card">
                <div className="mealmap-map-head">
                    <div>
                        <strong>{config.mapEnabled ? '카카오 지도 모드' : mt('mapTitle')}</strong>
                        <span>{loading ? '불러오는 중...' : `공개 장소 ${places.length}개`}</span>
                    </div>
                </div>

                <div className="mealmap-map-surface" ref={mapRef}>
                    {(config.mapEnabled && config.mapClientId) && (
                        <>
                            <div className="mealmap-real-map-layer" ref={kakaoMapCanvasRef} aria-label="카카오 지도" />
                            {mapStatus === 'loading' && (
                                <div className="mealmap-kakao-map-message">
                                    <strong>카카오 지도를 불러오는 중입니다.</strong>
                                    <span>잠시 후에도 보이지 않으면 카카오 JavaScript 키와 Web 플랫폼 도메인을 확인해주세요.</span>
                                </div>
                            )}
                            {mapStatus === 'error' && (
                                <div className="mealmap-kakao-map-message mealmap-kakao-map-message-error">
                                    <strong>카카오 지도를 불러오지 못했습니다.</strong>
                                    <span>{mapDebug || '카카오 Developers의 Web 플랫폼 도메인에 현재 주소가 등록되어 있는지, JavaScript 키가 맞는지 확인해주세요.'}</span>
                                    <small className="mealmap-kakao-debug-hint">점검 주소: /api/mealmap/kakao/js-test</small>
                                </div>
                            )}
                        </>
                    )}
                    {(!config.mapEnabled || !config.mapClientId) && (
                        <>
                            <div className="mealmap-grid-bg" />
                            <div className="mealmap-floating-help">
                                <strong>{isClusterMode ? '줌아웃: 등록 개수 표시' : '줌인: 가격/식당명 표시'}</strong>
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
                                <span>{selectedPlace.category || '식당'}</span>
                                <h2>{selectedPlace.name}</h2>
                                <p>{selectedPlace.address || selectedPlace.road_address || '-'}</p>
                            </div>
                            <button type="button" onClick={() => setSelectedPlace(null)} aria-label="상세 닫기">닫기</button>
                        </div>

                        <div className="mealmap-detail-meta">
                            <div><strong>가격</strong><span>{formatPrice(selectedPlace.min_price)} ~ {formatPrice(selectedPlace.max_price)}</span></div>
                            <div><strong>영업시간</strong><span>{selectedPlace.opening_hours || '-'}</span></div>
                            <div><strong>대표메뉴</strong><span>{selectedPlace.main_menu || '-'}</span></div>
                            <div><strong>제보자</strong><span>{selectedPlace.reporter_name || selectedPlace.reporter_id || '-'}</span></div>
                        </div>

                        {selectedPlace.report_note && <p className="mealmap-report-note">{selectedPlace.report_note}</p>}

                        <div className="mealmap-detail-actions">
                            <button type="button" className="mealmap-naver-btn" onClick={() => openExternalMap(selectedPlace)}>카카오맵/후기 보기</button>
                            <button type="button" className={`mealmap-like-btn ${selectedPlace?.liked_by_me ? 'is-liked' : ''}`} onClick={() => toggleLike(selectedPlace)}>{mt('likeButton')} {selectedPlace.like_count || 0}</button>
                            <button type="button" className="mealmap-action" onClick={() => openEditRequest(selectedPlace)}>{mt('editSuggestButton')}</button>
                            <button type="button" className="mealmap-action mealmap-history-btn" onClick={openActivityHistory}>활동 이력</button>
                        </div>

                        <section className="mealmap-comments">
                            <h3>{mt('commentTitle')}</h3>
                            {commentsLoading ? <p>댓글 불러오는 중...</p> : comments.length === 0 ? <p>아직 등록된 댓글이 없습니다.</p> : (
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
