// 최고관리자가 재인증한 경우에만 단일 회원의 개인정보 원문을 잠시 표시합니다.
import React from 'react';
import AdminModalBackdrop from './AdminModalBackdrop.jsx';

export default function AdminPrivacyRevealModal({
    privacyModal,
    setPrivacyModal,
    closePrivacyRevealModal,
    handlePrivacyReveal,
}) {
    if (!privacyModal.open) return null;

    const target = privacyModal.targetUser;
    const revealed = privacyModal.revealed;

    return (
      <AdminModalBackdrop onClose={closePrivacyRevealModal} canClose={!privacyModal.loading} labelledBy="admin-privacy-title">
        <form className="admin-mail-modal admin-privacy-modal" onSubmit={handlePrivacyReveal} onClick={(event) => event.stopPropagation()}>
          <div className="admin-mail-modal-head">
            <div>
              <p>최고관리자 제한 기능</p>
              <h2 id="admin-privacy-title">회원 개인정보 원문 열람</h2>
            </div>
            <button type="button" className="admin-mail-close" onClick={closePrivacyRevealModal} disabled={privacyModal.loading} aria-label="개인정보 열람 팝업 닫기">닫기</button>
          </div>

          <div className="admin-alert">
            대상 계정: <strong>{target?.id || '-'}</strong><br />
            목록에는 이름과 이메일이 항상 마스킹되며, 아래 원문은 서버나 브라우저 저장소에 별도로 저장하지 않습니다.
          </div>

          {revealed ? (
            <div className="admin-privacy-revealed" aria-live="polite">
              <label>
                <span>이름 원문</span>
                <input value={revealed.name || '-'} readOnly />
              </label>
              <label>
                <span>이메일 원문</span>
                <input value={revealed.email || '-'} readOnly />
              </label>
              <p className="admin-row-note">이 정보는 60초 뒤 자동으로 화면에서 사라집니다. 복사·재전송은 업무상 필요한 경우에만 진행해주세요.</p>
            </div>
          ) : (
            <>
              <label>
                <span>현재 관리자 비밀번호</span>
                <input
                  type="password"
                  value={privacyModal.password}
                  onChange={(event) => setPrivacyModal((prev) => ({ ...prev, password: event.target.value, error: '' }))}
                  autoComplete="current-password"
                  placeholder="현재 최고관리자 비밀번호"
                  autoFocus
                />
              </label>
              <label>
                <span id="admin-privacy-reason-label">열람 사유 (5자 이상)</span>
                <textarea
                  aria-labelledby="admin-privacy-reason-label"
                  value={privacyModal.reason}
                  onChange={(event) => setPrivacyModal((prev) => ({ ...prev, reason: event.target.value, error: '' }))}
                  maxLength={500}
                  rows={4}
                  placeholder="예: 회원 문의 본인 확인 및 이메일 주소 확인"
                />
              </label>
            </>
          )}

          {privacyModal.error ? <p className="admin-mail-error" role="alert">{privacyModal.error}</p> : null}
          <div className="admin-mail-actions">
            <button type="button" className="admin-mail-cancel" onClick={closePrivacyRevealModal} disabled={privacyModal.loading}>닫기</button>
            {!revealed ? (
              <button type="submit" className="admin-mail-submit" disabled={privacyModal.loading}>
                {privacyModal.loading ? '재인증 중...' : '재인증 후 원문 보기'}
              </button>
            ) : null}
          </div>
        </form>
      </AdminModalBackdrop>
    );
}
