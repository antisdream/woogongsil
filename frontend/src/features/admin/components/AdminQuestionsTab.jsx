// 관리자 기능 모듈입니다: AdminQuestionsTab
import React from 'react';
import {
    QUESTION_TYPE_OPTIONS,
    getQuestionLocation,
    getQuestionTypeLabel,
    shortText,
} from '../adminUtils.js';
import AdminQuestionDetailForm from './AdminQuestionDetailForm.jsx';
import AdminQuestionFilters from './AdminQuestionFilters.jsx';

export default function AdminQuestionsTab({
    questionError,
    questionSuccess,
    fetchQuestionMeta,
    fetchAdminQuestions,
    questionPage,
    questionMeta,
    questionTotal,
    totalQuestionPages,
    handleQuestionSearchSubmit,
    questionType,
    handleQuestionTypeChange,
    questionSearch,
    setQuestionSearch,
    questionFilters,
    setQuestionFilters,
    handleQuestionFilterReset,
    questionRows,
    loadingQuestions,
    selectedQuestion,
    loadingQuestionDetail,
    fetchQuestionDetail,
    handleQuestionPageMove,
    questionForm,
    savingQuestion,
    handleQuestionSave,
    handleQuestionFormChange,
}) {
    return (
        <section className="admin-panel admin-question-section">
            <div className="admin-panel-head">
                <div>
                    <h2>문제/해설 관리</h2>
                    <p>필기·실기 문제, 보기 이미지 경로, 해설 텍스트, 해설 이미지 경로를 확인하고 수정합니다.</p>
                </div>
                <button type="button" className="admin-primary-mini-btn" onClick={() => { fetchQuestionMeta(); fetchAdminQuestions({ page: questionPage }); }}>
                    문제 목록 새로고침
                </button>
            </div>

            {questionError && <div className="admin-alert admin-alert-error">{questionError}</div>}
            {questionSuccess && <div className="admin-alert admin-alert-success">{questionSuccess}</div>}

            <div className="admin-question-summary-grid">
                <article>
                    <span>필기 문제</span>
                    <strong>{questionMeta.summary?.written || 0}개</strong>
                </article>
                <article>
                    <span>실기 랜덤</span>
                    <strong>{questionMeta.summary?.ipepRandom || 0}개</strong>
                    <small>사용중 {questionMeta.summary?.ipepRandomActive || 0}개</small>
                </article>
                <article>
                    <span>실기 기출</span>
                    <strong>{questionMeta.summary?.ipepPast || 0}개</strong>
                    <small>사용중 {questionMeta.summary?.ipepPastActive || 0}개</small>
                </article>
                <article>
                    <span>현재 검색 결과</span>
                    <strong>{questionTotal}개</strong>
                    <small>{questionPage}/{totalQuestionPages} 페이지</small>
                </article>
            </div>

            <form className="admin-question-toolbar" onSubmit={handleQuestionSearchSubmit}>
                <select value={questionType} onChange={handleQuestionTypeChange} aria-label="문제 종류 선택">
                    {QUESTION_TYPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                </select>
                <input
                    type="text" value={questionSearch}
                    onChange={(event) => setQuestionSearch(event.target.value)}
                    placeholder="문제ID, 지문, 정답, 해설 검색" aria-label="문제 검색어"
                />
                <AdminQuestionFilters
                    questionType={questionType}
                    questionFilters={questionFilters}
                    setQuestionFilters={setQuestionFilters}
                    questionMeta={questionMeta}
                />
                <button type="submit">검색</button>
                <button type="button" className="admin-secondary-btn" onClick={handleQuestionFilterReset}>초기화</button>
            </form>

            <div className="admin-question-layout">
                <div className="admin-question-list-card">
                    <div className="admin-card-title-row">
                        <h3>{getQuestionTypeLabel(questionType)} 목록</h3>
                        <span className="admin-small-status">{loadingQuestions ? '불러오는 중...' : `총 ${questionTotal}개`}</span>
                    </div>

                    <div className="admin-table-scroll">
                        <table className="admin-user-table admin-question-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>위치</th>
                                    <th>문제 미리보기</th>
                                    <th>이미지</th>
                                    <th>상태</th>
                                    <th>관리</th>
                                </tr>
                            </thead>
                            <tbody>
                                {questionRows.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="admin-empty-cell">조회된 문제가 없습니다.</td>
                                    </tr>
                                ) : (
                                    questionRows.map((item) => (
                                        <tr key={`${item.type}-${item.question_id || item.id}`} className={(selectedQuestion?.question_id || selectedQuestion?.id) === (item.question_id || item.id) ? 'admin-row-highlight' : ''}>
                                            <td><strong>{item.question_id || item.id}</strong></td>
                                            <td>{getQuestionLocation(item)}</td>
                                            <td>{shortText(item.question_text || item.question)}</td>
                                            <td>
                                                <div className="admin-chip-row">
                                                    {(item.question_img || item.choice_img_file || item.choice_img_path) && <span>보기 이미지</span>}
                                                    {(item.explanation_img || item.explanation_img_file || item.explanation_img_path) && <span>해설 이미지</span>}
                                                    {!(item.question_img || item.choice_img_file || item.choice_img_path || item.explanation_img || item.explanation_img_file || item.explanation_img_path) && <span>없음</span>}
                                                </div>
                                            </td>
                                            <td>
                                                {item.type === 'written'? <span className="admin-badge">필기</span> : <span className={Number(item.is_active) ? 'admin-badge admin-badge-live' : 'admin-badge'}>{Number(item.is_active) ? '사용중' : '숨김'}</span>}
                                            </td>
                                            <td>
                                                <button type="button" className="admin-table-action-btn" onClick={() => fetchQuestionDetail(item.type, item.question_id || item.id)} disabled={loadingQuestionDetail}>
                                                    수정하기
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="admin-question-pagination">
                        <button type="button" onClick={() => handleQuestionPageMove(Math.max(1, questionPage - 1))} disabled={questionPage <= 1 || loadingQuestions}>이전</button>
                        <span>{questionPage} / {totalQuestionPages}</span>
                        <button type="button" onClick={() => handleQuestionPageMove(Math.min(totalQuestionPages, questionPage + 1))} disabled={questionPage >= totalQuestionPages || loadingQuestions}>다음</button>
                    </div>
                </div>

                <aside className="admin-question-detail-card">
                    <h3>선택 문제 수정</h3>
                    <p>
                        관리자 전용 API로 선택한 문제의 상세 정보를 수정합니다. 저장 전에는 DB 값이 변경되지 않습니다.
                    </p>
                    {loadingQuestionDetail ? <div className="admin-empty-box">상세 정보를 불러오는 중입니다.</div> : (
                        <AdminQuestionDetailForm
                            questionForm={questionForm}
                            selectedQuestion={selectedQuestion}
                            questionType={questionType}
                            savingQuestion={savingQuestion}
                            handleQuestionSave={handleQuestionSave}
                            handleQuestionFormChange={handleQuestionFormChange}
                        />
                    )}
                </aside>
            </div>
        </section>
    );
}
