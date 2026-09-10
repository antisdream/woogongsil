import { useEffect, useRef, useState } from 'react';
import { FiArrowRight, FiBookOpen, FiBookmark, FiCheck, FiCheckCircle, FiEdit3, FiHelpCircle, FiMousePointer, FiRotateCcw } from 'react-icons/fi';
import { getHomeHeroMotionVariant } from './homeHeroMotionPolicy.js';
import '../../styles/app/home-hero-motion.css';

function LearningStory() {
    const card = useRef(null);
    const answerSlot = useRef(null);
    const answerOption = useRef(null);
    const flyingAnswer = useRef(null);

    useEffect(() => {
        const positionAnswer = () => {
            const target = answerSlot.current;
            const source = answerOption.current;
            const token = flyingAnswer.current;
            if (!target || !source || !token || !card.current?.offsetWidth) return;
            token.style.left = `${target.offsetLeft}px`;
            token.style.top = `${target.offsetTop}px`;
            token.style.setProperty('--ui-flight-x', `${source.offsetLeft + 29 - target.offsetLeft}px`);
            token.style.setProperty('--ui-flight-y', `${source.offsetTop + 10 - target.offsetTop}px`);
        };
        positionAnswer();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(positionAnswer);
        observer.observe(card.current);
        return () => observer.disconnect();
    }, []);

    return <div className="ui-motion-story" aria-hidden="true">
        <div className="ui-motion-steps"><span>01 문제 풀이</span><span>02 해설 확인</span><span>03 오답 복습</span></div>
        <div className="ui-motion-question" ref={card}>
            <div className="ui-motion-question-top"><span>정보처리기사 · SQL 예제</span><span className="ui-motion-tag">학습 흐름</span></div>
            <h2>80점 이상인 학생을 찾으려면?</h2>
            <div className="ui-motion-code">SELECT name<br />FROM students<br /><span className="ui-motion-answer-slot" ref={answerSlot}><span className="ui-motion-blank">_____</span><span className="ui-motion-answer">WHERE</span></span> score &gt;= 80;</div>
            <div className="ui-motion-options">
                <span className="ui-motion-option"><b>①</b>GROUP BY</span>
                <span className="ui-motion-option"><b>②</b>ORDER BY</span>
                <span className="ui-motion-option ui-motion-right" ref={answerOption}><b>③</b>WHERE<FiMousePointer className="ui-motion-cursor" /><span className="ui-motion-burst"><i /><i /><i /><i /></span></span>
                <span className="ui-motion-option ui-motion-wrong"><b>④</b>HAVING<FiMousePointer className="ui-motion-cursor" /></span>
            </div>
            <span className="ui-motion-flying-answer" ref={flyingAnswer}>WHERE</span>
            <div className="ui-motion-feedback">
                <div className="ui-motion-prompt"><FiHelpCircle /><span>빈칸에 들어갈 조건절을 골라보세요.</span></div>
                <div className="ui-motion-hint"><FiRotateCcw /><span>그룹이 아닌, 각 행의 조건을 확인해요.</span></div>
                <div className="ui-motion-explain"><FiCheckCircle /><span>WHERE는 조건에 맞는 행을 선택해요.</span></div>
                <div className="ui-motion-review"><FiBookmark /><span>헷갈린 개념은 오답 노트로 복습해요.</span></div>
            </div>
        </div>
        <div className="ui-motion-review-note"><FiEdit3 /><span><strong>오답 복습</strong> · WHERE와 HAVING</span><FiCheck className="ui-motion-note-check" /></div>
    </div>;
}

function LearningBook() {
    return <div className="ui-motion-book-stage" aria-hidden="true">
        <div className="ui-motion-book-halo" />
        <span className="ui-motion-book-label ui-motion-book-label-one"><FiEdit3 />한 문제 풀고</span>
        <span className="ui-motion-book-label ui-motion-book-label-two"><FiCheckCircle />한 개념 이해하고</span>
        <div className="ui-motion-book">
            <div className="ui-motion-leaf ui-motion-leaf-left">
                <p className="ui-motion-leaf-caption">오늘의 문제 · SQL</p>
                <h2>80점 이상인<br />학생 찾기</h2>
                <p className="ui-motion-book-code">SELECT name<br />FROM students<br /><span>_____</span><br />score &gt;= 80;</p>
                <span className="ui-motion-page-number">01</span>
            </div>
            <div className="ui-motion-leaf ui-motion-leaf-right">
                <p className="ui-motion-leaf-caption">한 줄 해설</p>
                <h2>이해한 개념을,<br />나의 것으로.</h2>
                <p className="ui-motion-book-keyword"><FiCheck />WHERE</p>
                <p className="ui-motion-definition">조건에 맞는 행을<br />선택하는 조건절</p>
                <span className="ui-motion-paper-line" />
                <span className="ui-motion-page-number">03</span>
            </div>
            <div className="ui-motion-turn ui-motion-turn-first">
                <div className="ui-motion-face ui-motion-face-front">
                    <span className="ui-motion-ribbon" />
                    <p className="ui-motion-cover-caption">나의 학습 노트</p>
                    <p className="ui-motion-cover-title">한 장씩,<br />실력으로.</p>
                    <span className="ui-motion-paper-line" /><span className="ui-motion-paper-line" />
                    <span className="ui-motion-cover-footer"><FiBookOpen />우공실</span>
                </div>
                <div className="ui-motion-face ui-motion-face-back">
                    <p className="ui-motion-leaf-caption">기억해 둘 개념</p>
                    <p className="ui-motion-back-title">헷갈렸던<br />그 한 줄도.</p>
                    <p className="ui-motion-definition">다시 읽고,<br />다시 풀어보세요.</p>
                    <span className="ui-motion-paper-line" /><span className="ui-motion-paper-line" />
                    <span className="ui-motion-page-number">01</span>
                </div>
            </div>
            <div className="ui-motion-turn ui-motion-turn-second">
                <div className="ui-motion-face ui-motion-face-front">
                    <p className="ui-motion-leaf-caption">한 번 더 복습</p>
                    <p className="ui-motion-back-title">다시 풀면,<br />보이는 답.</p>
                    <p className="ui-motion-book-keyword"><FiCheck />WHERE</p>
                    <p className="ui-motion-definition">헷갈린 개념을<br />확실한 개념으로.</p>
                    <span className="ui-motion-page-number">02</span>
                </div>
                <div className="ui-motion-face ui-motion-face-back">
                    <p className="ui-motion-leaf-caption">나만의 오답 노트</p>
                    <p className="ui-motion-back-title">하나씩,<br />차곡차곡.</p>
                    <span className="ui-motion-paper-line" /><span className="ui-motion-paper-line" /><span className="ui-motion-paper-line" />
                    <span className="ui-motion-cover-footer"><FiBookmark />다음 학습으로</span>
                </div>
            </div>
        </div>
        <div className="ui-motion-book-shadow" />
        <div className="ui-motion-book-flow"><span>문제</span><FiArrowRight /><span>해설</span><FiArrowRight /><span>복습</span></div>
    </div>;
}

export default function HomeHeroMotion() {
    const root = useRef(null);
    const [variant] = useState(() => getHomeHeroMotionVariant(typeof navigator === 'undefined' ? '' : navigator.userAgent));
    const [inView, setInView] = useState(true);
    const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);

    useEffect(() => {
        const updateVisibility = () => setPageVisible(!document.hidden);
        document.addEventListener('visibilitychange', updateVisibility);
        const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
        observer?.observe(root.current);
        return () => {
            document.removeEventListener('visibilitychange', updateVisibility);
            observer?.disconnect();
        };
    }, []);

    const running = inView && pageVisible;
    return <section className="ui-hero-motion" ref={root} data-hero-motion={variant} data-motion-running={running} aria-label="학습 미리보기">
        <div className="ui-motion-toolbar">
            <span className="ui-motion-toolbar-label"><FiBookOpen aria-hidden="true" />학습 미리보기</span>
        </div>
        <div className="ui-motion-scene">
            {variant === 'story' ? <LearningStory /> : <LearningBook />}
            <p className="ui-sr-only">{variant === 'story' ? 'SQL 문제의 정답 WHERE를 확인하고, 헷갈린 개념을 오답으로 복습하는 학습 흐름입니다.' : '학습 노트의 책장이 넘어가며 SQL 문제, WHERE 해설, 오답 복습 과정을 보여줍니다.'}</p>
            <p className="ui-motion-disclaimer">설명용 예시이며 학습 기록에 저장되지 않아요.</p>
        </div>
    </section>;
}
