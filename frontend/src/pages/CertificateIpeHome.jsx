// 정보처리기사 입구 라우트 페이지 컴포넌트입니다.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import useScreenSettings from '../useScreenSettings';
import { FiArrowRight, FiBookOpen, FiEdit3 } from 'react-icons/fi';
import '../styles/app/learning-redesign.css';

// 정보처리기사 입구 화면 구성
// 역할:
// 1. 상단 메뉴의 “정보처리기사” 입구 화면입니다.
// 2. 필기와 실기를 한 곳에서 선택할 수 있게 하되,
//  실제 필기/실기 로비와 문제풀이 화면은 기존 컴포넌트를 그대로 사용합니다.
// 3. DB, API, 채점, 오답노트, 멀티플레이, 랭킹 로직은 유지합니다.

const cardStyle = {
    boxSizing: 'border-box',
    background: 'var(--wgs-card)',
    border: '1px solid var(--wgs-border)',
    borderRadius: '16px',
    padding: '26px',
    minHeight: '230px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxShadow: '0 10px 25px rgba(0,0,0,0.16)'
};

const buttonStyle = {
    width: '100%',
    padding: '14px 18px',
    borderRadius: '10px',
    border: 'none',
    color: '#ffffff',
    fontWeight: '900',
    fontSize: '16px',
    cursor: 'pointer'
};

function CertificateIpeHome() {
    const navigate = useNavigate();
    const { getSetting } = useScreenSettings('cert_ipe');

    const eyebrow = getSetting('hero.eyebrow', '국가기술자격 학습관');
    const pageTitle = getSetting('hero.page_title', '정보처리기사');
    const pageDesc = getSetting(
        'hero.page_desc',
        '지금 필요한 연습부터 시작하세요.\n필기는 선택형 문제로 개념을 확인하고, 실기는 직접 답안을 쓰며 준비합니다.'
    );
    const writtenTitle = getSetting('cards.written_title', '필기 학습');
    const writtenDesc = getSetting(
        'cards.written_desc',
        '한 문제씩 개념을 익히거나, 회차를 골라 시험처럼 풀어보세요.\n선택형 답안과 해설로 학습 내용을 확인합니다.'
    );
    const writtenButton = getSetting('cards.written_button_label', '필기 학습 시작');
    const practicalTitle = getSetting('cards.practical_title', '실기 학습');
    const practicalDesc = getSetting(
        'cards.practical_desc',
        '용어와 SQL, 코드 출력 문제의 답안을 직접 작성하세요.\n문제은행, 기출문제, 3주 공략 중 학습 방식을 고를 수 있습니다.'
    );
    const practicalButton = getSetting('cards.practical_button_label', '실기 학습 시작');
    const bottomNotice = getSetting(
        'notice.bottom_notice',
        '정보처리기사 메뉴에서 필기와 실기 학습을 한 번에 선택할 수 있으며,\n실제 문제풀이·기출응시·채점·오답 저장 기능은 동일하게 이용할 수 있습니다.'
    );

    return (
        <div
            className="cert-ipe-home-page exam-page wgs-typography-scope learning-page learning-lobby" style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--wgs-card)',
                border: '1px solid var(--wgs-border)',
                borderRadius: '14px',
                padding: '30px',
                color: 'var(--wgs-text)'
            }}
        >
            <div className="mobile-lobby-intro" style={{ marginBottom: '26px' }}>
                <p style={{ color: 'var(--wgs-muted)', fontWeight: '800', margin: '0 0 8px 0' }}>{eyebrow}</p>
                <h1
                    className="wgs-page-title learning-page-title" style={{
                        color: 'var(--wgs-title)',
                        fontSize: '34px',
                        fontWeight: '900',
                        lineHeight: 1.25,
                        margin: 0
                    }}
                >
                     {pageTitle}
                </h1>
                <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.7, margin: '14px 0 0 0', whiteSpace: 'pre-line' }}>
                    {pageDesc}
                </p>
            </div>

            <div
                className="mobile-lobby-grid learning-mode-grid"
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '18px'
                }}
            >
                <section className="mobile-lobby-card learning-mode-card" style={cardStyle}>
                    <div>
                        <span className="learning-mode-icon" aria-hidden="true"><FiBookOpen /></span>
                        <h3 style={{ color: '#60a5fa', fontSize: '24px', margin: '0 0 14px 0', fontWeight: '900' }}>{writtenTitle}</h3>
                        <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>
                            {writtenDesc}
                        </p>
                    </div>
                    <button
                        className="learning-primary" type="button" onClick={() => navigate('/cert/ipe/written')}
                        style={{ ...buttonStyle, background: '#3b82f6', marginTop: '20px' }}
                    >
                        {writtenButton}<FiArrowRight aria-hidden="true" />
                    </button>
                </section>

                <section className="mobile-lobby-card learning-mode-card" style={cardStyle}>
                    <div>
                        <span className="learning-mode-icon" aria-hidden="true"><FiEdit3 /></span>
                        <h3 style={{ color: '#34d399', fontSize: '24px', margin: '0 0 14px 0', fontWeight: '900' }}>{practicalTitle}</h3>
                        <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>
                            {practicalDesc}
                        </p>
                    </div>
                    <button
                        className="learning-primary" type="button" onClick={() => navigate('/cert/ipe/practical')}
                        style={{ ...buttonStyle, background: '#10b981', marginTop: '20px' }}
                    >
                        {practicalButton}<FiArrowRight aria-hidden="true" />
                    </button>
                </section>
            </div>

            <div
                style={{
                    marginTop: '22px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'var(--wgs-panel)',
                    border: '1px solid var(--wgs-border)',
                    color: 'var(--wgs-subtle)',
                    lineHeight: 1.7
                }}
            >
                <span style={{ whiteSpace: 'pre-line' }}>{bottomNotice}</span>
            </div>
        </div>
    );
}

export default CertificateIpeHome;
