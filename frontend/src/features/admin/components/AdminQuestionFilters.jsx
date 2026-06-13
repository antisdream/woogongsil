// 관리자 기능 모듈입니다: AdminQuestionFilters
import React from 'react';

function AdminQuestionFilters({ questionType, questionFilters, setQuestionFilters, questionMeta }) {
    if (questionType === 'written') {
      return (
        <>
          <input
            type="number" value={questionFilters.year}
            onChange={(event) => setQuestionFilters((prev) => ({ ...prev, year: event.target.value }))}
            placeholder="연도 예: 2025" aria-label="필기 연도 필터"
          />
          <input
            type="number" value={questionFilters.session}
            onChange={(event) => setQuestionFilters((prev) => ({ ...prev, session: event.target.value }))}
            placeholder="회차 예: 2" aria-label="필기 회차 필터"
          />
          <select
            value={questionFilters.subject}
            onChange={(event) => setQuestionFilters((prev) => ({ ...prev, subject: event.target.value }))}
            aria-label="필기 과목 필터"
          >
            <option value="">전체 과목</option>
            {(questionMeta.subjects || []).map((subject) => (
              <option key={subject.subject_id} value={subject.subject_id}>
                {subject.subject_id}. {subject.name}
              </option>
            ))}
          </select>
        </>
      );
    }

    if (questionType === 'ipep_random') {
      return (
        <>
          <select
            value={questionFilters.subjectCode}
            onChange={(event) => setQuestionFilters((prev) => ({ ...prev, subjectCode: event.target.value }))}
            aria-label="실기 랜덤 과목 필터"
          >
            <option value="">전체 과목</option>
            {(questionMeta.ipepSubjects || []).map((subject) => (
              <option key={subject.subject_code} value={subject.subject_code}>
                {subject.subject_code}. {subject.subject_name}
              </option>
            ))}
          </select>
          <select
            value={questionFilters.active}
            onChange={(event) => setQuestionFilters((prev) => ({ ...prev, active: event.target.value }))}
            aria-label="실기 랜덤 사용 여부 필터"
          >
            <option value="">전체 상태</option>
            <option value="1">사용중</option>
            <option value="0">숨김</option>
          </select>
        </>
      );
    }

    return (
      <>
        <input
          type="number" value={questionFilters.year}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, year: event.target.value }))}
          placeholder="시험연도 예: 2025" aria-label="실기 기출 연도 필터"
        />
        <input
          type="number" value={questionFilters.session}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, session: event.target.value }))}
          placeholder="회차 예: 2" aria-label="실기 기출 회차 필터"
        />
        <select
          value={questionFilters.active}
          onChange={(event) => setQuestionFilters((prev) => ({ ...prev, active: event.target.value }))}
          aria-label="실기 기출 사용 여부 필터"
        >
          <option value="">전체 상태</option>
          <option value="1">사용중</option>
          <option value="0">숨김</option>
        </select>
      </>
    );
  
}

export default AdminQuestionFilters;
