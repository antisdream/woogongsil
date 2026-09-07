// 관리자 기능 모듈입니다: AdminMailModal
import React from 'react';
import AdminModalBackdrop from './AdminModalBackdrop.jsx';

export default function AdminMailModal({
    mailModal,
    closeUserEmailModal,
    handleSendUserEmail,
    setMailModal,
}) {
    if (!mailModal.open) return null;

    return (
    <AdminModalBackdrop onClose={closeUserEmailModal} canClose={!mailModal.sending} labelledBy="admin-mail-title">
      <form className="admin-mail-modal" onSubmit={handleSendUserEmail} onClick={(event) => event.stopPropagation()}>
        <div className="admin-mail-modal-head">
          <div>
            <p>개인 이메일 전송</p>
            <h2 id="admin-mail-title">{mailModal.targetUser?.name || mailModal.targetUser?.id}님에게 메일 보내기</h2>
          </div>
          <button type="button" className="admin-mail-close" onClick={closeUserEmailModal} disabled={mailModal.sending} aria-label="메일 팝업 닫기">닫기</button>
        </div>
        <label>
          <span>받는 사람</span>
          <input value={mailModal.targetUser?.email || ''} readOnly />
        </label>
        <p className="admin-row-note">화면에는 마스킹된 주소만 표시되며, 실제 수신 주소는 전송 시 서버가 회원 ID로 조회합니다.</p>
        <label>
          <span>메일 제목</span>
          <input value={mailModal.subject} onChange={(event) => setMailModal((prev) => ({ ...prev, subject: event.target.value, error: '' }))} placeholder="관리자가 보낼 이메일 제목을 입력해 주세요." autoFocus />
        </label>
        <label>
          <span id="admin-mail-content-label">메일 내용</span>
          <textarea aria-labelledby="admin-mail-content-label" value={mailModal.message} onChange={(event) => setMailModal((prev) => ({ ...prev, message: event.target.value, error: '' }))} placeholder="안내사항, 공지사항 등 전달할 내용을 입력해 주세요." rows={10} />
        </label>
        {mailModal.error ? <p className="admin-mail-error" role="alert">{mailModal.error}</p> : null}
        <div className="admin-mail-actions">
          <button type="button" className="admin-mail-cancel" onClick={closeUserEmailModal} disabled={mailModal.sending}>취소</button>
          <button type="submit" className="admin-mail-submit" disabled={mailModal.sending}>{mailModal.sending ? '전송중...' : '전송'}</button>
        </div>
      </form>
    </AdminModalBackdrop>
    );
}
