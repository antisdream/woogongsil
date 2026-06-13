// 관리자 기능 모듈입니다: useAdminQuestions
import { useCallback, useState } from 'react';
import { toQuestionForm } from './adminUtils.js';

const DEFAULT_QUESTION_FILTERS = { year: '', session: '', subject: '', subjectCode: '', active: '' };
const QUESTION_PAGE_LIMIT = 20;

export default function useAdminQuestions({ makeAdminHeaders }) {
  const [questionMeta, setQuestionMeta] = useState({ summary: {}, subjects: [], ipepSubjects: [], ipepExamCatalog: [] });
  const [questionType, setQuestionType] = useState('written');
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionFilters, setQuestionFilters] = useState(DEFAULT_QUESTION_FILTERS);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionRows, setQuestionRows] = useState([]);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [questionForm, setQuestionForm] = useState(null);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [loadingQuestionDetail, setLoadingQuestionDetail] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [questionSuccess, setQuestionSuccess] = useState('');

  const fetchQuestionMeta = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/questions/meta', {
        method: 'GET',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '문제 관리 기본 정보를 불러오지 못했습니다.');
      }

      setQuestionMeta({
        summary: data.summary || {},
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        ipepSubjects: Array.isArray(data.ipepSubjects) ? data.ipepSubjects : [],
        ipepExamCatalog: Array.isArray(data.ipepExamCatalog) ? data.ipepExamCatalog : [],
      });
    } catch (error) {
      console.error('[admin] question meta fetch failed:', error);
      setQuestionError(error.message || '문제 관리 기본 정보를 불러오지 못했습니다.');
    }
  }, [makeAdminHeaders]);

  const buildQuestionQuery = useCallback(
    (overrides = {}) => {
      const nextType = overrides.type || questionType;
      const nextPage = overrides.page || questionPage;
      const nextSearch = overrides.search !== undefined ? overrides.search : questionSearch;
      const nextFilters = overrides.filters || questionFilters;

      const params = new URLSearchParams();
      params.set('type', nextType);
      params.set('page', String(nextPage));
      params.set('limit', String(QUESTION_PAGE_LIMIT));

      if (nextSearch.trim()) params.set('search', nextSearch.trim());

      if (nextType === 'written') {
        if (nextFilters.year) params.set('year', nextFilters.year);
        if (nextFilters.session) params.set('session', nextFilters.session);
        if (nextFilters.subject) params.set('subject', nextFilters.subject);
      }

      if (nextType === 'ipep_random') {
        if (nextFilters.subjectCode) params.set('subjectCode', nextFilters.subjectCode);
        if (nextFilters.active !== '') params.set('active', nextFilters.active);
      }

      if (nextType === 'ipep_past') {
        if (nextFilters.year) params.set('year', nextFilters.year);
        if (nextFilters.session) params.set('session', nextFilters.session);
        if (nextFilters.active !== '') params.set('active', nextFilters.active);
      }

      return params.toString();
    },
    [questionFilters, questionPage, questionSearch, questionType]
  );

  const fetchAdminQuestions = useCallback(
    async (overrides = {}) => {
      setLoadingQuestions(true);
      setQuestionError('');

      try {
        const query = buildQuestionQuery(overrides);
        const response = await fetch(`/api/admin/questions?${query}`, {
          method: 'GET',
          headers: makeAdminHeaders(),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          throw new Error(data.msg || data.message || '문제 목록을 불러오지 못했습니다.');
        }

        setQuestionRows(Array.isArray(data.rows) ? data.rows : []);
        setQuestionTotal(Number(data.total || 0));
      } catch (error) {
        console.error('[admin] questions fetch failed:', error);
        setQuestionError(error.message || '문제 목록을 불러오지 못했습니다.');
      } finally {
        setLoadingQuestions(false);
      }
    },
    [buildQuestionQuery, makeAdminHeaders]
  );

  const fetchQuestionDetail = useCallback(
    async (type, questionId) => {
      if (!type || !questionId) return;

      setLoadingQuestionDetail(true);
      setQuestionError('');
      setQuestionSuccess('');

      try {
        const response = await fetch(`/api/admin/questions/${type}/${questionId}`, {
          method: 'GET',
          headers: makeAdminHeaders(),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          throw new Error(data.msg || data.message || '문제 상세 정보를 불러오지 못했습니다.');
        }

        setSelectedQuestion(data.detail);
        setQuestionForm(toQuestionForm(data.detail, type));
      } catch (error) {
        console.error('[admin] question detail fetch failed:', error);
        setQuestionError(error.message || '문제 상세 정보를 불러오지 못했습니다.');
      } finally {
        setLoadingQuestionDetail(false);
      }
    },
    [makeAdminHeaders]
  );

  const handleQuestionSearchSubmit = useCallback((event) => {
    event.preventDefault();
    setQuestionPage(1);
    setQuestionSuccess('');
    fetchAdminQuestions({ page: 1 });
  }, [fetchAdminQuestions]);

  const handleQuestionTypeChange = useCallback((event) => {
    const nextType = event.target.value;
    const resetFilters = { ...DEFAULT_QUESTION_FILTERS };

    setQuestionType(nextType);
    setQuestionFilters(resetFilters);
    setQuestionPage(1);
    setSelectedQuestion(null);
    setQuestionForm(null);
    setQuestionSuccess('');
    fetchAdminQuestions({ type: nextType, page: 1, filters: resetFilters });
  }, [fetchAdminQuestions]);

  const handleQuestionFilterReset = useCallback(() => {
    const resetFilters = { ...DEFAULT_QUESTION_FILTERS };
    setQuestionSearch('');
    setQuestionFilters(resetFilters);
    setQuestionPage(1);
    setQuestionSuccess('');
    fetchAdminQuestions({ page: 1, search: '', filters: resetFilters });
  }, [fetchAdminQuestions]);

  const handleQuestionPageMove = useCallback((nextPage) => {
    setQuestionPage(nextPage);
    fetchAdminQuestions({ page: nextPage });
  }, [fetchAdminQuestions]);

  const handleQuestionFormChange = useCallback((field, value) => {
    setQuestionForm((prev) => ({ ...(prev || {}), [field]: value }));
  }, []);

  const handleQuestionSave = useCallback(async (event) => {
    event.preventDefault();

    if (!selectedQuestion || !questionForm) {
      setQuestionError('먼저 수정할 문제를 선택해주세요.');
      return;
    }

    setSavingQuestion(true);
    setQuestionError('');
    setQuestionSuccess('');

    try {
      const response = await fetch(`/api/admin/questions/${questionType}/${selectedQuestion.question_id || selectedQuestion.id}`, {
        method: 'PUT',
        headers: makeAdminHeaders(),
        body: JSON.stringify(questionForm),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.msg || data.message || '문제/해설 저장에 실패했습니다.');
      }

      setSelectedQuestion(data.detail);
      setQuestionForm(toQuestionForm(data.detail, questionType));
      setQuestionSuccess(data.msg || '문제/해설 정보가 저장되었습니다.');
      fetchAdminQuestions({ page: questionPage });
      fetchQuestionMeta();
    } catch (error) {
      console.error('[admin] question save failed:', error);
      setQuestionError(error.message || '문제/해설 저장에 실패했습니다.');
    } finally {
      setSavingQuestion(false);
    }
  }, [fetchAdminQuestions, fetchQuestionMeta, makeAdminHeaders, questionForm, questionPage, questionType, selectedQuestion]);

  return {
    questionMeta,
    questionType,
    questionSearch,
    setQuestionSearch,
    questionFilters,
    setQuestionFilters,
    questionPage,
    questionRows,
    questionTotal,
    totalQuestionPages: Math.max(1, Math.ceil(questionTotal / QUESTION_PAGE_LIMIT)),
    selectedQuestion,
    questionForm,
    loadingQuestions,
    loadingQuestionDetail,
    savingQuestion,
    questionError,
    questionSuccess,
    fetchQuestionMeta,
    fetchAdminQuestions,
    fetchQuestionDetail,
    handleQuestionSearchSubmit,
    handleQuestionTypeChange,
    handleQuestionFilterReset,
    handleQuestionPageMove,
    handleQuestionFormChange,
    handleQuestionSave,
  };
}
