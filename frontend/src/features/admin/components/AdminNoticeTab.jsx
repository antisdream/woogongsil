// 관리자 기능 모듈입니다: AdminNoticeTab
import React from 'react';

export default function AdminNoticeTab({
    fetchOperationLogs,
    operationLogType,
    operationLogPage,
    operationLogSort,
    noticeError,
    noticeSuccess,
    handleNoticeSubmit,
    noticeTitle,
    setNoticeTitle,
    noticeLevel,
    setNoticeLevel,
    noticeMessage,
    setNoticeMessage,
    sendingNotice,
    maintenanceError,
    maintenanceSuccess,
    maintenanceForm,
    setMaintenanceForm,
    fetchMaintenanceStatus,
    maintenanceLoading,
    maintenanceSaving,
    handleMaintenanceSave,
    handleOperationLogTypeToggle,
    handleOperationLogSortToggle,
    operationLogError,
    operationLogTotal,
    loadingOperationLogs,
    operationLogs,
    operationLogTotalPages,
    handleOperationLogPageMove,
}) {
    return (
        <>
            <section className="admin-panel admin-notice-panel">
                <div className="admin-panel-head">
                    <div>
                        <h2>전체 공지 발송</h2>
                        <p>현재 접속 중인 사용자에게 관리자 공지를 발송합니다.</p>
                    </div>

                    <button type="button" className="admin-primary-mini-btn" onClick={() => fetchOperationLogs({ type: operationLogType, page: operationLogPage, sort: operationLogSort })}>
                        최근 적용 내역 새로고침
                    </button>
                </div>

                {noticeError && <div className="admin-alert admin-alert-error">{noticeError}</div>}
                {noticeSuccess && <div className="admin-alert admin-alert-success">{noticeSuccess}</div>}

                <div className="admin-notice-layout">
                    <form className="admin-notice-form" onSubmit={handleNoticeSubmit}>
                        <label>
                            <span>공지 제목</span>
                            <input
                                type="text" value={noticeTitle}
                                maxLength={80}
                                onChange={(event) => setNoticeTitle(event.target.value)}
                                placeholder="예: 서버 점검 안내"
                            />
                        </label>

                        <label>
                            <span>공지 중요도</span>
                            <select value={noticeLevel} onChange={(event) => setNoticeLevel(event.target.value)}>
                                <option value="info">일반 안내</option>
                                <option value="warning">주의 안내</option>
                                <option value="urgent">긴급 안내</option>
                            </select>
                        </label>

                        <label className="admin-notice-message-label">
                            <span>공지 내용</span>
                            <textarea
                                value={noticeMessage}
                                maxLength={800}
                                onChange={(event) => setNoticeMessage(event.target.value)}
                                placeholder="접속 중인 사용자에게 보여줄 공지 내용을 입력하세요."
                            />
                        </label>

                        <div className="admin-notice-form-bottom">
                            <small>{noticeMessage.length}/800자</small>
                            <button type="submit" disabled={sendingNotice}>
                                {sendingNotice ? '발송 중...' : '전체 공지 발송'}
                            </button>
                        </div>
                    </form>
                </div>
            </section>

            <section className="admin-panel admin-maintenance-section">
                <div className="admin-panel-head">
                    <div>
                        <h2>사이트 점검 모드</h2>
                        <p>점검 모드를 켜면 관리자 계정을 제외한 사용자는 점검 안내 화면으로 이동하며, 일반 사용자의 신규 로그인이 차단됩니다.</p>
                    </div>
                </div>

                {maintenanceError && <div className="admin-alert admin-alert-error">{maintenanceError}</div>}
                {maintenanceSuccess && <div className="admin-alert admin-alert-success">{maintenanceSuccess}</div>}

                <div className="admin-maintenance-box">
                    <div className="admin-maintenance-status">
                        <span className={`admin-maintenance-badge ${maintenanceForm.enabled ? 'admin-maintenance-badge-on' : 'admin-maintenance-badge-off'}`}>
                            {maintenanceForm.enabled ? '점검 모드 ON' : '점검 모드 OFF'}
                        </span>
                        <div>
                            <strong>{maintenanceForm.enabled ? '현재 일반 사용자 접속 제한 중' : '현재 사이트 정상 이용 가능'}</strong>
                            <small>
                                {maintenanceForm.updatedAtText
                                    ? `최근 변경: ${maintenanceForm.updatedAtText}${maintenanceForm.updatedBy ? ` / 변경자: ${maintenanceForm.updatedBy}` : ''}`
                                    : '아직 점검 모드 변경 기록이 없습니다.'}
                            </small>
                        </div>
                    </div>

                    <label className="admin-maintenance-label" htmlFor="maintenance-message">
                        사용자에게 보여줄 점검 안내 문구
                    </label>
                    <textarea
                        id="maintenance-message" value={maintenanceForm.message}
                        onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, message: event.target.value }))}
                        placeholder="예: 현재 서버 점검 중입니다. 잠시 후 다시 접속해주세요."
                    />

                    <div className="admin-maintenance-actions">
                        <button type="button" onClick={fetchMaintenanceStatus} disabled={maintenanceLoading || maintenanceSaving}>
                            {maintenanceLoading ? '상태 확인 중...' : '상태 새로고침'}
                        </button>
                        <button
                            type="button" className={maintenanceForm.enabled ? 'admin-maintenance-off-button' : 'admin-maintenance-on-button'}
                            onClick={() => handleMaintenanceSave(!maintenanceForm.enabled)}
                            disabled={maintenanceSaving}
                        >
                            {maintenanceSaving
                                ? '저장 중...'
                                : maintenanceForm.enabled
                                    ? '점검 모드 끄기'
                                    : '점검 모드 켜기'}
                        </button>
                    </div>

                    <p className="admin-maintenance-help">
                        ※ 점검 상태 변경은 저장 즉시 일반 사용자 접속 화면에 반영됩니다.
                    </p>
                </div>
            </section>

            <section className="admin-panel admin-operation-log-section">
                <div className="admin-panel-head admin-operation-log-head">
                    <div>
                        <h2>최근 적용 내역</h2>
                        <p>전체 공지 발송 이력과 점검 모드 변경 이력을 관리자 권한자들이 함께 확인합니다.</p>
                    </div>

                    <div className="admin-operation-log-actions">
                        <button type="button" className="admin-secondary-mini-btn" onClick={handleOperationLogTypeToggle}>
                            {operationLogType === 'notice'? '점검 모드 이력 보기' : '전체 공지 이력 보기'}
                        </button>
                        <button type="button" className="admin-primary-mini-btn" onClick={handleOperationLogSortToggle}>
                            최근 이력 {operationLogSort === 'desc'? '내림차순' : '오름차순'}
                        </button>
                    </div>
                </div>

                {operationLogError && <div className="admin-alert admin-alert-error">{operationLogError}</div>}

                <div className="admin-operation-log-summary">
                    <strong>{operationLogType === 'notice'? '전체 공지 발송 이력' : '점검 모드 ON/OFF 이력'}</strong>
                    <span>총 {operationLogTotal}건 · 1페이지당 50개</span>
                </div>

                <div className="admin-table-scroll admin-operation-log-table-wrap">
                    <table className="admin-operation-log-table">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th>적용 구분</th>
                                <th>제목</th>
                                <th>상세 내용</th>
                                <th>적용자</th>
                                <th>최근 이력</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingOperationLogs ? (
                                <tr>
                                    <td colSpan="6" className="admin-table-empty">최근 적용 내역을 불러오는 중입니다.</td>
                                </tr>
                            ) : operationLogs.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="admin-table-empty">조회된 최근 적용 내역이 없습니다.</td>
                                </tr>
                            ) : (
                                operationLogs.map((log, index) => (
                                    <tr key={`${log.operationType}-${log.id}`}>
                                        <td>{operationLogSort === 'desc'? operationLogTotal - ((operationLogPage - 1) * 50 + index) : ((operationLogPage - 1) * 50 + index + 1)}</td>
                                        <td>
                                            <span className={`admin-operation-type-pill ${log.operationType === 'maintenance'? 'is-maintenance' : 'is-notice'}`}>
                                                {log.operationType === 'maintenance'? `점검 ${log.action}` : '공지 발송'}
                                            </span>
                                        </td>
                                        <td>{log.title || '-'}</td>
                                        <td className="admin-operation-message">{log.message || '-'}</td>
                                        <td>{log.actorName || log.actorId || '-'}</td>
                                        <td>{log.createdAt || '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="admin-approval-pagination admin-operation-pagination">
                    <button type="button" onClick={() => handleOperationLogPageMove(Math.max(1, operationLogPage - 1))} disabled={operationLogPage <= 1 || loadingOperationLogs}>
                        이전
                    </button>
                    <span>{operationLogPage} / {operationLogTotalPages}</span>
                    <button type="button" onClick={() => handleOperationLogPageMove(Math.min(operationLogTotalPages, operationLogPage + 1))} disabled={operationLogPage >= operationLogTotalPages || loadingOperationLogs}>
                        다음
                    </button>
                </div>
            </section>
        </>
    );
}
