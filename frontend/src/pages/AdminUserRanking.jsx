// 관리자 사용자 랭킹 라우트 페이지 컴포넌트입니다.
import React from 'react';
import { useParams } from 'react-router-dom';
import MyRankingHistoryChart from '../components/MyRankingHistoryChart';

export default function AdminUserRanking() {
  const { targetUserId } = useParams();

  return (
    <div className="admin-user-ranking-page">
      <div className="admin-user-ranking-head">
        <h1>사용자 성적 조회</h1>
        <p>관리자 페이지에서 선택한 사용자의 개인 랭킹 히스토리입니다.</p>
      </div>
      <MyRankingHistoryChart targetUserId={targetUserId} titlePrefix={`${targetUserId || ''} 사용자`} />
    </div>
  );
}
