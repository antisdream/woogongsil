import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowRight, FiArrowUpRight, FiBookOpen, FiCheck, FiEdit3, FiRotateCcw } from 'react-icons/fi';
import '../../styles/app/landing-redesign.css';

const sampleOptions = ['GROUP BY', 'ORDER BY', 'WHERE', 'HAVING'];
function LearningPreview() {
    const [answer, setAnswer] = useState(null);
    const [submitted, setSubmitted] = useState(false);
    return <section className="ui-learning-preview" aria-labelledby="ui-preview-title">
        <div className="ui-preview-heading"><span><FiEdit3 aria-hidden="true" /> 학습 미리보기</span><span className="ui-preview-tag">직접 풀어보세요</span></div>
        <div className="ui-preview-body">
            <p className="ui-preview-topic">정보처리기사 · SQL 예제</p>
            <h2 id="ui-preview-title">조건에 맞는 행을 선택할 때<br className="ui-desktop-break" /> 사용하는 절은?</h2>
            <pre className="ui-sql-example"><code><span>SELECT</span> name <span>FROM</span> students{`\n`}<mark>_____</mark> score &gt;= 80;</code></pre>
            <fieldset className="ui-preview-options" disabled={submitted}>
                <legend className="ui-sr-only">정답을 하나 선택하세요</legend>
                {sampleOptions.map((option, index) => <label key={option} className={`ui-preview-option ${answer === index ? 'is-selected' : ''} ${submitted && index === 2 ? 'is-correct' : ''}`}>
                    <input type="radio" name="home-example-answer" value={index} checked={answer === index} onChange={() => setAnswer(index)} />
                    <span className="ui-option-number">{index + 1}</span><span>{option}</span>{submitted && index === 2 && <FiCheck aria-hidden="true" />}
                </label>)}
            </fieldset>
            <div className="ui-preview-feedback" aria-live="polite" aria-atomic="true">{submitted && <div className="ui-preview-explanation"><strong>{answer === 2 ? '정답이에요.' : '정답은 WHERE예요.'}</strong><p>WHERE는 조건에 맞는 행을 선택합니다. 이 쿼리는 점수가 80점 이상인 학생의 이름을 가져와요.</p></div>}</div>
            <button type="button" className={submitted ? 'ui-secondary ui-preview-submit' : 'ui-primary ui-preview-submit'} disabled={!submitted && answer === null} onClick={() => { if (submitted) { setSubmitted(false); setAnswer(null); } else setSubmitted(true); }}>{submitted ? '다시 풀어보기' : '정답과 해설 확인'}<FiArrowRight aria-hidden="true" /></button>
            <p className="ui-preview-disclaimer">설명용 예제입니다. 결과는 학습 기록에 저장되지 않아요.</p>
        </div>
    </section>;
}

export default function HomeHero({ homeDefaultBanner, homeHeroTitle, homeHeroDesc, loggedInUser, dDay, calcDday, homeWelcomePrefix, homeWelcomeSuffix, homeDdayPrefix, homeDdaySuffix, homeHeroLayout }) {
    const align = (value) => ['left','center','right'].includes(value) ? value : 'left';
    const offset = (value) => Math.min(200, Math.max(-200, Number(value) || 0));
    const titleStyle = { textAlign: align(homeHeroLayout?.titleAlign), '--ui-hero-x': `${offset(homeHeroLayout?.titleOffsetX)}px`, '--ui-hero-y': `${offset(homeHeroLayout?.titleOffsetY)}px` };
    const descStyle = { textAlign: align(homeHeroLayout?.descAlign), '--ui-hero-x': `${offset(homeHeroLayout?.descOffsetX)}px`, '--ui-hero-y': `${offset(homeHeroLayout?.descOffsetY)}px` };
    return <div className="ui-home-intro" style={{ maxWidth: homeHeroLayout?.contentWidth || '100%', marginInline: 'auto' }}>
        <section className="ui-home-hero" aria-labelledby="ui-home-title">
            <div className="ui-hero-copy">
                {String(homeHeroTitle || '').trim() && <p className="ui-hero-scope" style={titleStyle}><span aria-hidden="true" />{homeHeroTitle}</p>}
                {loggedInUser && <p className="ui-hero-welcome">{homeWelcomePrefix} {loggedInUser}{homeWelcomeSuffix}{dDay && <span>{homeDdayPrefix} {calcDday()}{homeDdaySuffix}</span>}</p>}
                <h1 id="ui-home-title">오늘 푼 한 문제를,<br /><em>내일의 실력으로.</em></h1>
                <p className="ui-hero-description" style={descStyle}>{homeHeroDesc}</p>
                <div className="ui-hero-actions"><Link className="ui-primary" to={loggedInUser ? '/cert/ipe' : '/login'}>학습 시작하기<FiArrowRight aria-hidden="true" /></Link><Link className="ui-hero-text-link" to={loggedInUser ? '/wrong' : '/faq'}>{loggedInUser ? '오답 복습하기' : '이용 방법 보기'}<FiArrowUpRight aria-hidden="true" /></Link></div>
                <p className="ui-hero-note">필기 문제은행 · 기출문제 · 실기 연습<br />문제를 풀고 해설을 확인하며, 부족한 부분을 다시 공부하세요.</p>
                {homeDefaultBanner && <img className="ui-configured-banner" src={homeDefaultBanner} alt="우공실 학습 안내" loading="lazy" />}
            </div>
            <LearningPreview />
        </section>
        <section className="ui-learning-journey" aria-labelledby="ui-journey-title">
            <div className="ui-journey-intro"><p className="ui-eyebrow">공부의 흐름을 이어가세요</p><h2 id="ui-journey-title">풀고, 이해하고,<br />다시 내 것으로.</h2></div>
            <ol>
                <li><span className="ui-step-icon"><FiEdit3 aria-hidden="true" /></span><div><small>01 · 문제 풀이</small><h3>지금 필요한 연습부터</h3><p>문제은행으로 한 문제씩, 기출로 한 회차씩 연습해요.</p></div></li>
                <li><span className="ui-step-icon"><FiBookOpen aria-hidden="true" /></span><div><small>02 · 해설 확인</small><h3>답보다 이유를 남기기</h3><p>틀린 이유를 확인하고 헷갈렸던 개념을 정리해요.</p></div></li>
                <li><span className="ui-step-icon"><FiRotateCcw aria-hidden="true" /></span><div><small>03 · 오답 복습</small><h3>다음에는 맞힐 수 있도록</h3><p>회원 계정으로 저장한 오답을 모아 다시 풀어봐요.</p></div></li>
            </ol>
        </section>
        <section className="ui-home-help" aria-labelledby="ui-home-help-title">
            <div><p className="ui-eyebrow">시작 전에 궁금하다면</p><h2 id="ui-home-help-title">공부는 가볍게,<br />이용 방법은 분명하게.</h2><Link to="/faq" className="ui-hero-text-link">전체 이용 안내 <FiArrowRight aria-hidden="true" /></Link></div>
            <div className="ui-home-faq">
                <details><summary>어떤 공부를 할 수 있나요?</summary><p>정보처리기사 필기 문제은행과 기출, 실기 문제은행·기출·3주완성 모드를 이용할 수 있어요. 학습 선택 화면에서 원하는 방식을 고르세요.</p></details>
                <details><summary>학습 기록과 오답은 어디에서 보나요?</summary><p>로그인한 회원은 내 기록과 오답 복습에서 본인에게 저장된 기록을 확인할 수 있어요. 홈페이지 예제 풀이 결과는 저장되지 않아요.</p></details>
                <details><summary>휴대폰에서도 사용할 수 있나요?</summary><p>휴대폰 브라우저에서 현재 사이트 주소로 접속하면 같은 학습 기능을 이용할 수 있어요.</p></details>
            </div>
        </section>
    </div>;
}
