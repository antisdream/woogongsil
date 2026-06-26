'use strict';

const {
    SUBJECT_NAMES,
    normalizeMpExamType,
    getMpExamTypeLabel
} = require('./multiplayerQuestionUtils');

function createMultiplayerRecordBoard({ pool, getRoomQuestionsWithAnswer } = {}) {
    if (!pool) throw new Error('createMultiplayerRecordBoard requires mysql pool');
    if (typeof getRoomQuestionsWithAnswer !== 'function') {
        throw new Error('createMultiplayerRecordBoard requires getRoomQuestionsWithAnswer');
    }

    function formatDateOnly(value) {
        // MySQL DATETIME/Date 객체를 응시 날짜 필터용 YYYY-MM-DD 문자열로 변환합니다.
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatTimeOnly(value) {
        // MySQL DATETIME/Date 객체를 응시 시간 필터용 HH:mm:ss 문자열로 변환합니다.
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    }

    function buildFailReason(subjectScores, averageScore) {
        // 필기 합격 기준: 과목별 40점 이상 + 전체 평균 60점 이상을 문장으로 정리합니다.
        const weakSubjects = subjectScores.filter((s) => Number(s.score || 0) < 40).map((s) => s.subjectName);
        const reasons = [];
        if (weakSubjects.length >0) reasons.push(`${weakSubjects.join(', ')}이 합격 조건에 맞지 않습니다`);
        if (Number(averageScore || 0) < 60) reasons.push('평균점수가 합격 조건에 맞지 않습니다');
        return reasons.length >0 ? `${reasons.join(', ')}. 아쉽게도 불합격 하셨습니다.` : '';
    }

    function buildSubjectSummaryFromQuestionResults(questionResults = []) {
        // 저장된 응답 목록을 기준으로 사용자별 과목 점수와 합격/불합격 사유를 다시 계산합니다.
        const subjectScores = SUBJECT_NAMES.map((name) => ({ subjectName: name, correctCount: 0, totalCount: 0, score: 0, pass: false }));
        let correctCount = 0;

        for (const item of questionResults) {
            const subjectIndex = Math.min(4, Math.max(0, Number(item.subject_no || Math.ceil(Number(item.cbtNo || item.question_order || 1) / 20)) - 1));
            subjectScores[subjectIndex].totalCount += 1;
            if (item.is_correct || item.isCorrect) {
                correctCount += 1;
                subjectScores[subjectIndex].correctCount += 1;
            }
        }

        for (const subject of subjectScores) {
            subject.score = subject.correctCount * 5;
            subject.pass = subject.score >= 40;
        }

        const totalCount = questionResults.length || 100;
        const averageScore = totalCount >0 ? Math.round((correctCount / totalCount) * 100) : 0;
        const isPass = averageScore >= 60 && subjectScores.every((s) => s.pass);

        return {
            correctCount,
            totalCount,
            averageScore,
            subjectScores,
            isPass,
            reason: buildFailReason(subjectScores, averageScore)
        };
    }

    async function buildRoomRecordBoard(room) {
        // 방 번호/비밀번호로 전체 제출 현황, 사용자별 PASS/NP, 문제별 정답자/오답자를 만든다.
        const [members] = await pool.query(
            `SELECT user_id, user_name, role, status, submitted_at
             FROM wgs_multiplayer_room_members
             WHERE room_id = ? AND status <> ' LEFT' ORDER BY joined_at ASC, id ASC`,
            [room.id]
        );

        const [results] = await pool.query(
            `SELECT * FROM wgs_multiplayer_results WHERE room_id = ?`,
            [room.id]
        );

        const submittedCount = results.length;
        const totalMembers = members.length;
        if (totalMembers >0 && submittedCount < totalMembers) {
            return {
                ready: false,
                submittedCount,
                totalMembers,
                msg: '현재 모든 사용자가 시험을 마치지 않았습니다, 잠시 후 시도해주시기 바랍니다.'
            };
        }

        const questions = await getRoomQuestionsWithAnswer(room.id, true);

        // 오답 다시풀기 삭제 연동
        // ------------------------------------------------------------
        // 4. 오답문제 풀러가기에서 선택 삭제/전체 삭제한 오답은
        // wgs_multiplayer_wrong_hides에 기록됩니다.
        // 시험 기록 확인하기 화면과 HTML/PDF용 오답 정리에서도 같은 숨김 기준을
        // 적용해야 삭제한 오답이 다시 보이지 않는다.
        // 원본 결과/참여자 데이터는 보존하고, 문제별 정답자/오답자 표에서만
        // 삭제 처리된 개인 오답은 채점표 응답에서 제외합니다.
        const [hiddenWrongRows] = await pool.query(
            `SELECT user_id, question_id
               FROM wgs_multiplayer_wrong_hides
              WHERE room_id = ?`,
            [room.id]
        );
        const hiddenWrongKeys = new Set(
            hiddenWrongRows.map((row) => `${String(row.user_id)}:${String(row.question_id)}`)
        );

        const resultMap = new Map(results.map((r) => [String(r.user_id), r]));
        const participants = [];
        const answerByUser = new Map();

        for (const member of members) {
            const [answers] = await pool.query(
                `SELECT question_id, selected_answer, is_correct
                 FROM wgs_multiplayer_answers
                 WHERE room_id = ? AND user_id = ?`,
                [room.id, member.user_id]
            );
            const ansMap = new Map(answers.map((a) => [String(a.question_id), a]));
            answerByUser.set(String(member.user_id), ansMap);

            let storedSubjectScores = [];
            const stored = resultMap.get(String(member.user_id));
            try {
                storedSubjectScores = stored && typeof stored.subject_scores_json === 'string'? JSON.parse(stored.subject_scores_json || '[]')
                    : stored?.subject_scores_json || [];
            } catch (e) {
                storedSubjectScores = [];
            }

            const questionResults = questions.map((q) => {
                const answer = ansMap.get(String(q.question_id));
                return {
                    ...q,
                    selected_answer: answer ? answer.selected_answer : null,
                    is_correct: answer ? Boolean(answer.is_correct) : false
                };
            });
            const calculated = buildSubjectSummaryFromQuestionResults(questionResults);
            const subjectScores = storedSubjectScores.length >0
                ? storedSubjectScores.map((s, idx) => ({ ...s, pass: Number(s.score || 0) >= 40, subjectName: s.subjectName || SUBJECT_NAMES[idx] }))
                : calculated.subjectScores;
            const averageScore = stored ? Number(stored.average_score || 0) : calculated.averageScore;
            const isPass = stored ? Boolean(stored.is_pass) : calculated.isPass;

            participants.push({
                userId: member.user_id,
                name: member.user_name,
                role: member.role,
                correctCount: stored ? Number(stored.correct_count || 0) : calculated.correctCount,
                totalCount: stored ? Number(stored.total_count || questions.length || 100) : calculated.totalCount,
                averageScore,
                subjectScores,
                isPass,
                reason: isPass ? '' : buildFailReason(subjectScores, averageScore),
                submittedAt: member.submitted_at
            });
        }

        const rows = questions.map((q) => {
            const correctNames = [];
            const wrongNames = [];
            for (const member of members) {
                const ans = answerByUser.get(String(member.user_id))?.get(String(q.question_id));
                const hiddenWrongKey = `${String(member.user_id)}:${String(q.question_id)}`;

                // 4번 화면에서 삭제한 오답은 3번 시험 기록/HTML/PDF용 오답표에서도 제외합니다.
                // 정답자는 그대로 유지하고, 삭제 처리된 오답자 이름만 표에서 제거합니다.
                if (hiddenWrongKeys.has(hiddenWrongKey)) continue;

                if (ans && Boolean(ans.is_correct)) correctNames.push(member.user_name);
                else wrongNames.push(member.user_name);
            }
            return {
                no: q.cbtNo,
                question_id: q.question_id,
                sourceLabel: q.sourceLabel,
                actualNo: q.info_id,
                correctLabel: q.correct_label,
                questionText: q.question_text,
                // HTML/PDF용 오답 정리 페이지에서도 필기 <보기> 이미지를 렌더링할 수 있도록 이미지 별칭을 같이 내려줍니다.
                question_img: q.question_img,
                questionImg: q.questionImg,
                choice_img_stem: q.choice_img_stem,
                choice_img_file: q.choice_img_file,
                choice_img_path: q.choice_img_path,
                choiceImgPath: q.choiceImgPath,
                questionImgPath: q.questionImgPath,
                imagePath: q.imagePath,
                image: q.image,
                options: q.options,
                // 필기 문제 해설은 SELECT 별칭과 원본 필드 중 사용 가능한 값을 우선 적용합니다.
                // 결과 화면과 전체 채점표에서 같은 해설 데이터를 표시하기 위한 처리입니다.
                explanation: q.explanation || q.explanation_text || '',
                explanation_text: q.explanation_text || q.explanation || '',
                explanation_img_path: q.explanation_img_path || q.explanationImgPath || '',
                explanationImgPath: q.explanationImgPath || q.explanation_img_path || '',
                questionSource: q.questionSource || q.question_source,
                question_source: q.question_source || q.questionSource,
                correctNames,
                wrongNames
            };
        });

        // 4번 '오답 문제 풀러가기'에서 선택 삭제/전체 삭제한 오답은
        // 3번 '시험 기록 확인하기'의 문제별 오답표와 HTML/PDF용 데이터에서도 제외합니다.
        // 주의:
        // - wgs_multiplayer_results의 점수/제출 기록은 채점 원본이므로 유지합니다.
        // - 삭제하지 않은 다른 참여자의 오답은 계속 확인할 수 있어야 하므로,
        //  question_id 기준이 아니라 '남아있는 오답자(wrongNames)' 기준으로만 필터링합니다.
        const visibleWrongRows = rows.filter((row) => (row.wrongNames || []).length >0);

        return {
            ready: true,
            examType: normalizeMpExamType(room.exam_type),
            exam_type: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            roomCode: room.room_code,
            roomPassword: room.room_password,
            submittedCount,
            totalMembers,
            participants,
            rows: visibleWrongRows,
            wrongItems: visibleWrongRows
        };
    }


    return {
        buildRoomRecordBoard,
        formatDateOnly,
        formatTimeOnly
    };
}

module.exports = {
    createMultiplayerRecordBoard
};
