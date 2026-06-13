// 관리자 기능 모듈입니다: AdminQuestionDetailForm
import React from 'react';
import {
  IPEP_GRADING_POLICY_OPTIONS,
  buildImagePreviewSrc,
  getQuestionLocation,
  getQuestionTypeLabel,
} from '../adminUtils.js';

function AdminQuestionDetailForm({
  questionForm,
  selectedQuestion,
  questionType,
  savingQuestion,
  handleQuestionSave,
  handleQuestionFormChange,
}) {
    if (!questionForm) {
      return (
        <div className="admin-question-empty-detail">
          목록에서 수정할 문제를 선택하면 이 영역에 상세 수정 폼이 열립니다.
        </div>
      );
    }

    const selectedId = selectedQuestion?.question_id || selectedQuestion?.id || questionForm.question_id;

    if (questionType === 'written') {
      const questionImgSrc = buildImagePreviewSrc('written', questionForm.question_img);
      const explanationImgSrc = buildImagePreviewSrc('written', questionForm.explanation_img);

      return (
        <form className="admin-question-form" onSubmit={handleQuestionSave}>
          <div className="admin-question-form-head">
            <div>
              <span>필기 문제 #{selectedId}</span>
              <strong>{getQuestionLocation({ ...selectedQuestion, ...questionForm, type: 'written' })}</strong>
            </div>
            <button type="submit" disabled={savingQuestion}>{savingQuestion ? '저장 중...' : '수정 내용 저장'}</button>
          </div>

          <div className="admin-question-form-grid">
            <label>
              <span>연도</span>
              <input type="number" value={questionForm.year} onChange={(event) => handleQuestionFormChange('year', event.target.value)} />
            </label>
            <label>
              <span>회차</span>
              <input type="number" value={questionForm.session} onChange={(event) => handleQuestionFormChange('session', event.target.value)} />
            </label>
            <label>
              <span>문항 순서(info_id)</span>
              <input type="number" value={questionForm.info_id} onChange={(event) => handleQuestionFormChange('info_id', event.target.value)} />
            </label>
            <label>
              <span>과목 번호</span>
              <input type="number" value={questionForm.subject} onChange={(event) => handleQuestionFormChange('subject', event.target.value)} />
            </label>
          </div>

          <label className="admin-question-wide-label">
            <span>문제 지문</span>
            <textarea value={questionForm.question} onChange={(event) => handleQuestionFormChange('question', event.target.value)} />
          </label>

          <div className="admin-question-image-grid">
            <label>
              <span>보기/문제 이미지 파일명</span>
              <input value={questionForm.question_img} onChange={(event) => handleQuestionFormChange('question_img', event.target.value)} placeholder="예: 20250101.png" />
              {questionImgSrc ? <img src={questionImgSrc} alt="문제 이미지 미리보기" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <small>이미지 파일명이 없으면 미리보기가 표시되지 않습니다.</small>}
            </label>
            <label>
              <span>해설 이미지 파일명</span>
              <input value={questionForm.explanation_img} onChange={(event) => handleQuestionFormChange('explanation_img', event.target.value)} placeholder="예: 20250101_ex.png" />
              {explanationImgSrc ? <img src={explanationImgSrc} alt="해설 이미지 미리보기" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <small>해설 이미지가 없으면 비워둬도 됩니다.</small>}
            </label>
          </div>

          <div className="admin-question-options-grid">
            {[1, 2, 3, 4].map((num) => (
              <label key={num}>
                <span>보기 {num}</span>
                <textarea value={questionForm[`opt${num}`]} onChange={(event) => handleQuestionFormChange(`opt${num}`, event.target.value)} />
              </label>
            ))}
          </div>

          <div className="admin-question-form-grid">
            <label>
              <span>정답 번호(correct_label)</span>
              <select value={questionForm.correct_label} onChange={(event) => handleQuestionFormChange('correct_label', event.target.value)}>
                <option value="">선택</option>
                <option value="1">1번</option>
                <option value="2">2번</option>
                <option value="3">3번</option>
                <option value="4">4번</option>
              </select>
            </label>
            <label>
              <span>options.answer 보조값</span>
              <input value={questionForm.answer} onChange={(event) => handleQuestionFormChange('answer', event.target.value)} placeholder="정답 컬럼 값" />
            </label>
          </div>

          <label className="admin-question-wide-label">
            <span>해설 텍스트</span>
            <textarea value={questionForm.explanation_text} onChange={(event) => handleQuestionFormChange('explanation_text', event.target.value)} />
          </label>

          <p className="admin-question-help">
            ※ 필기 문제는 questions, options, answers 세 테이블에 나뉘어 있어 저장 시 선택한 한 문제의 세 테이블 값만 갱신합니다.
          </p>
        </form>
      );
    }

    const choiceImgSrc = buildImagePreviewSrc(questionType, questionForm.choice_img_path || questionForm.choice_img_file);
    const explanationImgSrc = buildImagePreviewSrc(questionType, questionForm.explanation_img_path || questionForm.explanation_img_file);

    return (
      <form className="admin-question-form" onSubmit={handleQuestionSave}>
        <div className="admin-question-form-head">
          <div>
            <span>{getQuestionTypeLabel(questionType)} #{selectedId}</span>
            <strong>{getQuestionLocation({ ...selectedQuestion, ...questionForm, type: questionType })}</strong>
          </div>
          <button type="submit" disabled={savingQuestion}>{savingQuestion ? '저장 중...' : '수정 내용 저장'}</button>
        </div>

        <div className="admin-question-form-grid">
          {questionType === 'ipep_random'? (
            <>
              <label>
                <span>과목 코드</span>
                <input value={questionForm.subject_code} onChange={(event) => handleQuestionFormChange('subject_code', event.target.value)} placeholder="예: 01" />
              </label>
              <label>
                <span>과목 내 번호</span>
                <input type="number" value={questionForm.subject_no} onChange={(event) => handleQuestionFormChange('subject_no', event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label>
                <span>시험 연도</span>
                <input type="number" value={questionForm.exam_year} onChange={(event) => handleQuestionFormChange('exam_year', event.target.value)} />
              </label>
              <label>
                <span>시험 회차</span>
                <input type="number" value={questionForm.exam_session} onChange={(event) => handleQuestionFormChange('exam_session', event.target.value)} />
              </label>
              <label>
                <span>문항 번호</span>
                <input type="number" value={questionForm.question_no} onChange={(event) => handleQuestionFormChange('question_no', event.target.value)} />
              </label>
            </>
          )}
          <label>
            <span>사용 여부</span>
            <select value={questionForm.is_active} onChange={(event) => handleQuestionFormChange('is_active', event.target.value)}>
              <option value="1">사용중</option>
              <option value="0">숨김</option>
            </select>
          </label>
          <label>
            <span>배점</span>
            <input type="number" value={questionForm.score} onChange={(event) => handleQuestionFormChange('score', event.target.value)} />
          </label>
          <label>
            <span>채점 방식</span>
            <select value={questionForm.grading_policy} onChange={(event) => handleQuestionFormChange('grading_policy', event.target.value)}>
              {IPEP_GRADING_POLICY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="admin-question-wide-label">
          <span>실기 문제 지문</span>
          <textarea value={questionForm.question_text} onChange={(event) => handleQuestionFormChange('question_text', event.target.value)} />
        </label>

        <div className="admin-question-options-grid">
          <label>
            <span>정답 원문(answer_raw)</span>
            <textarea value={questionForm.answer_raw} onChange={(event) => handleQuestionFormChange('answer_raw', event.target.value)} />
          </label>
          <label>
            <span>정규화 정답(answer_normalized)</span>
            <textarea value={questionForm.answer_normalized} onChange={(event) => handleQuestionFormChange('answer_normalized', event.target.value)} />
          </label>
          <label>
            <span>정답 별칭 JSON(answer_aliases_json)</span>
            <textarea value={questionForm.answer_aliases_json} onChange={(event) => handleQuestionFormChange('answer_aliases_json', event.target.value)} placeholder='예: ["정답", "동의어"]' />
          </label>
          <label>
            <span>부분점수 JSON(answer_slots_json)</span>
            <textarea value={questionForm.answer_slots_json} onChange={(event) => handleQuestionFormChange('answer_slots_json', event.target.value)} placeholder='예: [{"answers":["A"],"score":2}]' />
          </label>
        </div>

        <div className="admin-question-image-grid">
          <label>
            <span>보기 이미지</span>
            <input value={questionForm.choice_img_file} onChange={(event) => handleQuestionFormChange('choice_img_file', event.target.value)} placeholder="파일명" />
            <input value={questionForm.choice_img_path} onChange={(event) => handleQuestionFormChange('choice_img_path', event.target.value)} placeholder="저장 경로 또는 /ipep-img/..." />
            <input value={questionForm.choice_img_stem} onChange={(event) => handleQuestionFormChange('choice_img_stem', event.target.value)} placeholder="확장자 제외 stem" />
            {choiceImgSrc ? <img src={choiceImgSrc} alt="실기 보기 이미지 미리보기" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <small>보기 이미지가 없으면 비워둬도 됩니다.</small>}
          </label>
          <label>
            <span>해설 이미지</span>
            <input value={questionForm.explanation_img_file} onChange={(event) => handleQuestionFormChange('explanation_img_file', event.target.value)} placeholder="파일명" />
            <input value={questionForm.explanation_img_path} onChange={(event) => handleQuestionFormChange('explanation_img_path', event.target.value)} placeholder="저장 경로 또는 /ipep-img/..." />
            <input value={questionForm.explanation_img_stem} onChange={(event) => handleQuestionFormChange('explanation_img_stem', event.target.value)} placeholder="확장자 제외 stem" />
            {explanationImgSrc ? <img src={explanationImgSrc} alt="실기 해설 이미지 미리보기" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <small>해설 이미지가 없으면 비워둬도 됩니다.</small>}
          </label>
        </div>

        <label className="admin-question-wide-label">
          <span>실기 해설 텍스트</span>
          <textarea value={questionForm.explanation_text} onChange={(event) => handleQuestionFormChange('explanation_text', event.target.value)} placeholder="실기 DB에 explanation_text 컬럼이 없으면 백엔드가 없는 컬럼만 자동 추가합니다." />
        </label>

        <p className="admin-question-help">
          ※ 실기 JSON 입력칸은 반드시 올바른 JSON 형식이어야 저장됩니다. 잘못 입력하면 저장하지 않고 오류를 보여줍니다.
        </p>
      </form>
    );
  
}

export default AdminQuestionDetailForm;
