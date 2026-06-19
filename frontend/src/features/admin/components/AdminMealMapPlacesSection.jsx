// 관리자 기능 모듈입니다: AdminMealMapPlacesSection
import React from 'react';

export default function AdminMealMapPlacesSection({
    fetchMealMapAdminPlaces,
    mealMapLoading,
    mealMapStats,
    mealMapStatusFilter,
    setMealMapStatusFilter,
    mealMapKeyword,
    setMealMapKeyword,
    mealMapError,
    mealMapSuccess,
    mealMapPlaces,
    mealMapSavingId,
    runMealMapAdminAction,
}) {
    return (
    <section className="admin-panel admin-mealmap-panel">
      <div className="admin-panel-head">
        <div>
          <h2>회식맵 관리</h2>
          <p>사용자가 제보한 회식 장소는 바로 공개됩니다. 공개 식당을 확인하고, 삭제가 필요한 항목은 결재 요청으로 숨김 처리합니다.</p>
        </div>
        <button type="button" className="admin-secondary-button" onClick={fetchMealMapAdminPlaces} disabled={mealMapLoading}>
          {mealMapLoading ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      <div className="admin-mealmap-stat-grid">
        <article className="admin-mealmap-stat-card"><span>승인 대기</span><strong>{mealMapStats.pending || 0}</strong></article>
        <article className="admin-mealmap-stat-card"><span>승인 완료</span><strong>{mealMapStats.approved || 0}</strong></article>
        <article className="admin-mealmap-stat-card"><span>반려</span><strong>{mealMapStats.rejected || 0}</strong></article>
        <article className="admin-mealmap-stat-card"><span>숨김</span><strong>{mealMapStats.hidden || 0}</strong></article>
      </div>

      <div className="admin-mealmap-toolbar">
        <div>
          <select value={mealMapStatusFilter} onChange={(event) => setMealMapStatusFilter(event.target.value)}>
            <option value="pending">승인 대기</option>
            <option value="approved">승인 완료</option>
            <option value="rejected">반려</option>
            <option value="hidden">숨김</option>
            <option value="all">전체</option>
          </select>
          <input
            value={mealMapKeyword}
            onChange={(event) => setMealMapKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') fetchMealMapAdminPlaces(); }}
            placeholder="식당명/주소/제보자 검색"
          />
          <button type="button" className="admin-secondary-button" onClick={fetchMealMapAdminPlaces}>검색</button>
        </div>
        <p>카카오 지도 API 키가 없어도 제보 DB는 먼저 쌓이고, 공개된 데이터는 회식맵에 바로 표시됩니다.</p>
      </div>

      {mealMapError && <p className="admin-error-message">{mealMapError}</p>}
      {mealMapSuccess && <p className="admin-success-message">{mealMapSuccess}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>상태</th>
              <th>식당명</th>
              <th>카테고리</th>
              <th>가격</th>
              <th>주소</th>
              <th>제보자</th>
              <th>댓글/좋아요</th>
              <th>지도 링크</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {mealMapPlaces.length === 0 ? (
              <tr><td colSpan="10">조건에 맞는 회식맵 제보가 없습니다.</td></tr>
            ) : mealMapPlaces.map((place) => (
              <tr key={place.id}>
                <td>{place.id}</td>
                <td>{place.status}</td>
                <td><strong>{place.name}</strong><br /><small>{place.main_menu || '-'}</small></td>
                <td>{place.category}</td>
                <td>{Number(place.min_price || 0).toLocaleString('ko-KR')}원 ~ {Number(place.max_price || 0).toLocaleString('ko-KR')}원</td>
                <td>{place.address}<br /><small>{place.road_address || ''}</small></td>
                <td>{place.reporter_name || place.reporter_id || '-'}</td>
                <td>{place.comment_count || 0} / {place.like_count || 0}</td>
                <td className="admin-mealmap-url-cell">
                  {(place.kakao_url || place.naver_url) ? (
                    <a href={place.kakao_url || place.naver_url} target="_blank" rel="noreferrer">카카오</a>
                  ) : '-'}
                </td>
                <td>
                  <div className="admin-mealmap-actions">
                    {place.status === 'pending' && (
                      <>
                        <button type="button" className="approve" disabled={mealMapSavingId === place.id} onClick={() => runMealMapAdminAction(place, 'approve')}>승인</button>
                        <button type="button" className="reject" disabled={mealMapSavingId === place.id} onClick={() => runMealMapAdminAction(place, 'reject')}>반려</button>
                      </>
                    )}
                    {place.status !== 'hidden' && (
                      <button type="button" className="danger" disabled={mealMapSavingId === place.id} onClick={() => runMealMapAdminAction(place, 'delete')}>삭제 요청</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    );
}
