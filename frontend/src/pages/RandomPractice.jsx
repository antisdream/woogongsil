// 필기 문제은행 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import DrawingBoard from './DrawingBoard'; 
import ErrorReportButton from '../components/ErrorReportButton';

const API_BASE = "";


// 필기 해설 텍스트 추출 유틸
// ------------------------------------------------------------
// 백엔드 응답 이름이 화면마다 조금씩 다를 수 있어서
// explanation_text, explanationText, explanation 등을 모두 확인합니다.
// 기존 문제/정답/오답 로직은 변경하지 않고, 화면 출력용 값만 안전하게 꺼냅니다.
const getWrittenExplanation = (item) => {
    const raw = item?.explanation_text
        || item?.explanationText
        || item?.explanation
        || item?.answer_explanation
        || item?.answerExplanation
        || '';

    return String(raw || '').trim();
};

const getSubjectName = (id) => {
    try {
        if (id === undefined || id === null || id === '') return "과목 정보 없음";
        const strId = String(id).trim();
        const lastChar = strId.charAt(strId.length - 1);

        switch (lastChar) {
            case "0": return "1과목 : 소프트웨어 설계";
            case "1": return "2과목 : 소프트웨어 개발";
            case "2": return "3과목 : 데이터베이스 구축";
            case "3": return "4과목 : 프로그래밍 언어 활용";
            case "4": return "5과목 : 정보시스템 구축 관리";
            default: return `과목 : ${strId}`;
        }
    } catch (e) {
        return "과목 정보 없음";
    }
};

const RandomPractice = () => {
    // 필기 문제은행에서 필기 로비(/cert/ipe/written)로 돌아가기 위해 사용합니다.
    const navigate = useNavigate();
    const [question, setQuestion] = useState(null);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState(null);
    const [loadError, setLoadError] = useState(false);
    
    const [myRankData, setMyRankData] = useState(null);
    
    const [showDrawing, setShowDrawing] = useState(false); 

    const userId = sessionStorage.getItem('userId');
    const userName = sessionStorage.getItem('userName');
    
    const nextButtonRef = useRef(null);

    const fetchRandomQuestion = async () => {
        try {
            setLoadError(false);
            const res = await axios.get(`${API_BASE}/api/random-question`);
            
            if (!res.data || Object.keys(res.data).length === 0) {
                throw new Error("문제 데이터가 비어있습니다.");
            }
            
            setQuestion(res.data);
            setSelectedAnswer(null);
            setIsSubmitted(false);
            setIsCorrect(null);
            setMyRankData(null);
            setShowDrawing(false); 
        } catch (err) {
            console.error("문제 로딩 에러:", err);
            setLoadError(true);
        }
    };

    useEffect(() => {
        fetchRandomQuestion();
     
    }, []);

    const handleGrade = async () => {
        if (!selectedAnswer) return alert("정답을 선택해주세요!");
        
        setIsSubmitted(true);
        const correct = String(selectedAnswer) === String(question.correct_label);
        setIsCorrect(correct);

        if (!correct && userId) {
            try {
                //   오답 저장 시 year와 session을 명시적으로 넘겨주어 백엔드에서 null로 갱신하지 않게 방지합니다.
                await axios.post(`${API_BASE}/api/save-wrong`, { 
                    id: userId, 
                    source: 'random',
                    year: question.year,
                    session: question.session,
                    wrongQuestions: [question] 
                });
            } catch (err) { console.error("오답 저장 실패"); }
        }

        if (userId) {
            try {
                await axios.post(`${API_BASE}/api/practice-results`, {
                    userId, userName, questionId: question.question_id, isCorrect: correct
                });

                const rankRes = await axios.get(`${API_BASE}/api/rankings?type=random`);
                if (rankRes.data.isRegularSeason && rankRes.data.rankings) {
                    const rawRankings = rankRes.data.rankings;
                    
                    const processed = rawRankings.map(user => {
                        const c = Number(user.correct || user.correct_count || 0);
                        const t = Number(user.total || user.solved_count || 0);
                        return { ...user, score: c * 5, accuracy: t >0 ? Math.round((c / t) * 100) : 0, correct: c };
                    });
                    
                    processed.sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.correct - a.correct);
                    
                    const meIndex = processed.findIndex(u => String(u.id) === String(userId) || String(u.userId) === String(userId));
                    if (meIndex !== -1) {
                        setMyRankData({ 
                            rank: `${meIndex + 1}등`, 
                            score: processed[meIndex].score, 
                            accuracy: processed[meIndex].accuracy 
                        });
                    }
                }
            } catch (err) { console.error("결과 저장/랭킹 업데이트 실패"); }
        }

        setTimeout(() => {
            if (nextButtonRef.current) {
                nextButtonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    };

    if (loadError) return <div style={{ color: 'white', textAlign: 'center', padding: '50px' }}>문제를 불러오는데 실패했습니다. 서버를 확인해주세요.</div>;
    if (!question) return <div style={{ color: 'white', textAlign: 'center', padding: '50px' }}>문제를 불러오는 중입니다...</div>;

    const hasOptionsArray = question.options && Array.isArray(question.options) && question.options.length >0;

    return (
        <div
            className="exam-page written-exam-page random-practice-page wgs-typography-scope" style={{ width: '100%', maxWidth: '800px', margin: '0 auto', color: 'var(--wgs-text)', paddingBottom: '50px', boxSizing: 'border-box' }}
        >
            {/* 실기 페이지와 구조를 맞추기 위해 필기 문제은행에도 필기 로비 이동 버튼을 추가했습니다. */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '15px' }}>
                <button
                    onClick={() => navigate('/cert/ipe/written')}
                    style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    필기 로비
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                {/*   문제은행 상단 뱃지에 연도, 회차, 문제 번호 출력 추가합니다. */}
                <div style={{ background: '#3b82f6', color: 'white', padding: '6px 12px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px' }}>
                    [{question.year}년 {question.session}회차 {question.info_id}번] {getSubjectName(question.subject_id)}
                </div>
            </div>

            <div className="exam-question-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px' }}>
                {/* 문제은행 제목은 공통 섹션 제목 클래스 기준으로 통일합니다. */}
                <h2 className="wgs-section-title" style={{ color: 'var(--wgs-blue)', margin: 0 }}>오늘의 문제은행</h2>
                {/* 현재 보고 있는 필기 문제은행 문항을 관리자에게 즉시 신고하는 버튼입니다. */}
                <ErrorReportButton
                    examType="필기" mode="문제은행" questionInfo={{
                        year: question?.year,
                        round: question?.session,
                        number: question?.info_id || question?.question_id || question?.id,
                        subject: getSubjectName(question?.subject_id),
                        title: question?.question_text,
                    }}
                />
            </div>

            <div style={{ fontSize: '18px', lineHeight: '1.6', margin: '20px 0', padding: '20px', background: 'var(--wgs-input-bg)', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--wgs-blue)', marginRight: '10px' }}>Q.</span>
                {question.question_text}
            </div>

            {question.question_img && (
                <div style={{ textAlign: 'center', margin: '20px 0', width: '100%' }}>
                    <img 
                        src={`/question_image/${question.question_img}`} 
                        alt="문제 첨부 이미지" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '4px' }}
                        onError={(e) => { e.target.style.display = 'none'; }} 
                    />
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {hasOptionsArray ? (
                    question.options.map((opt) => (
                        <button key={opt.label} onClick={() => !isSubmitted && setSelectedAnswer(opt.label)}
                            style={{ padding: '15px', textAlign: 'left', borderRadius: '8px', background: selectedAnswer === opt.label ? '#3b82f6' : 'var(--wgs-input-bg)', border: `1px solid ${selectedAnswer === opt.label ? 'var(--wgs-blue)' : 'var(--wgs-border)'}`, color: 'white', cursor: isSubmitted ? 'default' : 'pointer', fontSize: '16px', transition: 'all 0.2s ease-in-out' }}>
                            <strong style={{ display: 'inline-block', width: '30px' }}>{opt.label}.</strong> {opt.option_text || opt.text}
                        </button>
                    ))
                ) : (
                    [1, 2, 3, 4].map(num => {
                        const optText = question[`option_${num}`] || question[`option${num}`];
                        if (!optText) return null;
                        return (
                            <button key={num} onClick={() => !isSubmitted && setSelectedAnswer(num)}
                                style={{ padding: '15px', textAlign: 'left', borderRadius: '8px', background: selectedAnswer === num ? '#3b82f6' : 'var(--wgs-input-bg)', border: `1px solid ${selectedAnswer === num ? 'var(--wgs-blue)' : 'var(--wgs-border)'}`, color: 'white', cursor: isSubmitted ? 'default' : 'pointer', fontSize: '16px', transition: 'all 0.2s ease-in-out' }}>
                                <strong style={{ display: 'inline-block', width: '30px' }}>{num}.</strong> {optText}
                            </button>
                        );
                    })
                )}
            </div>

            <div style={{ marginTop: '30px', textAlign: 'center' }}>
                {!isSubmitted ? (
                    <>
                        <button onClick={handleGrade} style={{ padding: '15px 40px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            정답 확인하기
                        </button>
                        
                        <div style={{ marginTop: '15px' }}>
                            <button onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px solid #3b82f6', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', transition: '0.2s' }}>
                                {showDrawing ? '연습장 닫기' : '연습장 열기'}
                            </button>
                        </div>
                        {showDrawing && <DrawingBoard />}
                    </>
                ) : (
                    <div style={{ animation: 'fadeIn 0.5s' }}>
                        <div style={{ padding: '20px', background: isCorrect ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `2px solid ${isCorrect ? '#10b981' : '#ef4444'}`, borderRadius: '8px', marginBottom: '18px' }}>
                            <h3 style={{ color: isCorrect ? '#10b981' : '#ef4444', margin: '0 0 10px 0' }}>
                                {isCorrect ? '정답입니다!' : '아쉽습니다, 다시 도전해보세요!'}
                            </h3>
                            {!isCorrect && <p style={{ margin: 0, fontSize: '16px', color: 'white' }}>정답은 <strong style={{ color: '#10b981' }}>{question.correct_label}번</strong> 입니다.</p>}
                            {!isCorrect && userId && <p style={{ margin: '10px 0 0 0', color: 'var(--wgs-muted)', fontSize: '14px' }}>※ 틀린 문제는 마이페이지의 오답노트에 자동 저장되었습니다.</p>}
                        </div>

                        {/* ============================================================
                            필기 문제은행 해설 출력 영역
                            ------------------------------------------------------------
                            정답/오답 여부와 상관없이 제출 후 항상 보여줍니다.
                            요청 위치: 정답/오답 결과 박스 아래, 랭킹 업데이트 박스 위.
                            ============================================================ */}
                        <div
                            className="written-explanation-box" style={{
                                margin: '0 0 20px 0',
                                padding: '18px 20px',
                                background: 'rgba(59, 130, 246, 0.08)',
                                border: '1px solid rgba(59, 130, 246, 0.45)',
                                borderRadius: '10px',
                                textAlign: 'left',
                                color: 'var(--wgs-title)',
                                lineHeight: 1.7,
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ fontWeight: '900', color: '#60a5fa', marginBottom: '8px', fontSize: '16px' }}>
                                해설
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px' }}>
                                {getWrittenExplanation(question) || '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/random-question 응답에 explanation_text가 포함되는지 확인해야 합니다.'}
                            </div>
                        </div>

                        {myRankData && (
                            <div className="random-rank-row" style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '12px', borderRadius: '8px', border: '1px dashed #fcd34d', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                                <span style={{ color: '#fcd34d', fontWeight: 'bold', fontSize: '15px' }}>내 랭킹 업데이트!</span>
                                <span style={{ color: 'white', fontSize: '15px' }}>
                                    <strong style={{ color: '#fcd34d' }}>{myRankData.rank || '순위권 밖'}</strong> ({myRankData.score ?? 0}점, 정답률 {myRankData.accuracy ?? 0}%)
                                </span>
                            </div>
                        )}

                        <button ref={nextButtonRef} onClick={fetchRandomQuestion} style={{ padding: '15px 40px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            다음 문제 풀기
                        </button>
                        
                        <div style={{ marginTop: '15px' }}>
                            <button onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px dashed var(--wgs-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                                {showDrawing ? '연습장 닫기' : '연습장 열기'}
                            </button>
                        </div>
                        {showDrawing && <DrawingBoard />}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RandomPractice;
