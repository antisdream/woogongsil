// 관리자 사용자 랭킹 라우트 페이지 컴포넌트입니다.
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import MyRankingHistoryChart from '../components/MyRankingHistoryChart';

export default function AdminUserRanking() {
  const { targetUserId } = useParams();
  const endpoint = `/api/admin/users/${encodeURIComponent(targetUserId || '')}/ranking-history`;

  return (
    <main id="admin-main-content" className="admin-user-ranking-page" tabIndex={-1}>
      <Link className="admin-back-link" to="/manage/users"><FiArrowLeft aria-hidden="true" />사용자 관리로 돌아가기</Link>
      <div className="admin-user-ranking-head">
        <p className="admin-page-eyebrow">회원 학습 기록</p>
        <h1>사용자 성적 조회</h1>
        <p><strong>{targetUserId}</strong> 계정의 랭킹 기록입니다.</p>
      </div>
      <MyRankingHistoryChart
        targetUserId={targetUserId}
        titlePrefix={`${targetUserId || ''} 사용자`}
        apiEndpoints={[endpoint]}
      />
    </main>
  );
}
