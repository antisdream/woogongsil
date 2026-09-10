import axios from 'axios';
import { memberRequestHeaders } from './memberRequestHeaders.js';

export const learningRequestOptions = () => ({ headers: memberRequestHeaders(), withCredentials: true });

export async function submitLearningAttempt(attemptId, answers) {
    if (!attemptId) throw new Error('문제를 다시 불러온 뒤 제출해주세요.');
    const response = await axios.post(`/api/learning-attempts/${encodeURIComponent(attemptId)}/submit`, { answers }, learningRequestOptions());
    if (!response.data?.success) throw new Error(response.data?.msg || '채점에 실패했습니다.');
    return response.data;
}

export async function submitReviewAnswer(source, questionId, answer) {
    const response = await axios.post('/api/learning-attempts/review', { source, questionId }, learningRequestOptions());
    const result = await submitLearningAttempt(response.data.attemptId, { [questionId]: answer });
    return result.grades[0];
}
