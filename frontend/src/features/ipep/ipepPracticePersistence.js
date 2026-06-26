import axios from 'axios';

export const buildIpepSessionAuth = (userId = '') => ({
    id: sessionStorage.getItem('userId') || userId || '',
    userId: sessionStorage.getItem('userId') || userId || '',
    sessionToken: sessionStorage.getItem('sessionToken') || '',
    serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
});

export async function saveIpepRankingRecord({
    apiBase,
    getSessionAuth,
    userId,
    userName,
    mode,
    totalCount,
    correctCount,
    totalScore,
    maxScore,
    year = null,
    session = null,
}) {
    if (!userId) return;
    try {
        await axios.post(`${apiBase}/api/ipep-ranking`, {
            ...getSessionAuth(),
            id: userId,
            userName,
            mode,
            totalCount,
            correctCount,
            totalScore,
            maxScore,
            year,
            session
        });
    } catch (err) {
        console.warn('실기 랭킹 저장 실패:', err);
    }
}

export async function saveIpepWrongNotesRecord({
    apiBase,
    getSessionAuth,
    userId,
    source,
    wrongQuestions,
    year = null,
    session = null,
}) {
    if (!userId || wrongQuestions.length === 0) return;
    try {
        await axios.post(`${apiBase}/api/save-ipep-wrong`, {
            ...getSessionAuth(),
            id: userId,
            source,
            year,
            session,
            wrongQuestions
        });
    } catch (err) {
        console.warn('실기 오답노트 저장 실패:', err);
    }
}

export function normalizeIpepWrongQuestionForSave({
    question,
    userAnswer,
    source,
    result = {},
    selectedExam = null,
}) {
    // SQL의 wgs_wrong_notes.question_id는 INT이므로 문자열 key를 넣으면 JOIN이 깨집니다.
    // 그래서 question_id에는 반드시 DB 원본 question_id 숫자만 넣고, 화면용 key는 wrong_key로 따로 보관합니다.
    const numericQuestionId = Number(question.questionId || question.question_id || question.id);

    return {
        ...question,
        question_id: numericQuestionId,
        questionId: numericQuestionId,
        wrong_key: `${source}-${numericQuestionId || question.qNumber || question.questionText}`,
        source,
        id: numericQuestionId,
        qno: question.qNumber || question.qno || question.no || question.question_no,
        subject: question.subjectName || question.subject || question.subjectCode || question.subject_code || '',
        question_text: question.questionText || question.question_text || question.question || '',
        // 실기 보기 이미지는 question_img가 아니라 choice_img_path 계열에 들어있는 경우가 많습니다.
        choiceImgPath: question.choiceImgPath || question.choice_img_path || question.imagePath || question.image || '',
        explanationImgPath: question.explanationImgPath || question.explanation_img_path || question.explanation_img_file || '',
        question_img: question.choiceImgPath || question.choice_img_path || question.questionImgPath || question.question_img || question.img || '',
        correct_answer: result.correctAnswer || result.correct_answer || question.correctAnswer || question.correct_answer || question.answer_normalized || question.answer_raw || '',
        explanation: result.explanation || question.explanation || question.explanationText || '',
        user_answer: userAnswer || '',
        score: Number(question.score || result.maxScore || 5),
        year: selectedExam?.examYear || question.examYear || question.exam_year || null,
        session: selectedExam?.examSession || question.examSession || question.exam_session || null
    };
}
