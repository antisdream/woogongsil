// 정보처리기사 입구 라우트 페이지 컴포넌트입니다.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import useScreenSettings from '../useScreenSettings';

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
        '필기와 실기 학습 메뉴를 하나의 정보처리기사 페이지에서 선택합니다.\n각 버튼을 누르면 필기 학습 로비와 실기 학습 로비로 이동합니다.'
    );
    const writtenTitle = getSetting('cards.written_title', '필기 학습');
    const writtenDesc = getSetting(
        'cards.written_desc',
        '필기 학습 로비로 이동합니다.\n필기 문제은행과 필기 기출문제를 한 화면에서 선택할 수 있습니다.'
    );
    const writtenButton = getSetting('cards.written_button_label', '필기 로비로 이동');
    const practicalTitle = getSetting('cards.practical_title', '실기 학습');
    const practicalDesc = getSetting(
        'cards.practical_desc',
        '실기 학습 로비로 이동합니다.\n실기 문제은행과 실기 기출문제를 한 화면에서 선택할 수 있습니다.'
    );
    const practicalButton = getSetting('cards.practical_button_label', '실기 로비로 이동');
    const bottomNotice = getSetting(
        'notice.bottom_notice',
        '정보처리기사 메뉴에서 필기와 실기 학습을 한 번에 선택할 수 있으며,\n실제 문제풀이·기출응시·채점·오답 저장 기능은 동일하게 이용할 수 있습니다.'
    );

    return (
        <div
            className="cert-ipe-home-page exam-page wgs-typography-scope" style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--wgs-card)',
                border: '1px solid var(--wgs-border)',
                borderRadius: '14px',
                padding: '30px',
                color: 'var(--wgs-text)'
            }}
        >
            <div style={{ marginBottom: '26px' }}>
                <p style={{ color: 'var(--wgs-muted)', fontWeight: '800', margin: '0 0 8px 0' }}>{eyebrow}</p>
                <h2
                    className="wgs-page-title" style={{
                        color: 'var(--wgs-title)',
                        fontSize: '34px',
                        fontWeight: '900',
                        lineHeight: 1.25,
                        margin: 0
                    }}
                >
                     {pageTitle}
                </h2>
                <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.7, margin: '14px 0 0 0', whiteSpace: 'pre-line' }}>
                    {pageDesc}
                </p>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '18px'
                }}
            >
                <section style={cardStyle}>
                    <div>
                        <h3 style={{ color: '#60a5fa', fontSize: '24px', margin: '0 0 14px 0', fontWeight: '900' }}>{writtenTitle}</h3>
                        <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>
                            {writtenDesc}
                        </p>
                    </div>
                    <button
                        type="button" onClick={() => navigate('/cert/ipe/written')}
                        style={{ ...buttonStyle, background: '#3b82f6', marginTop: '20px' }}
                    >
                        {writtenButton}
                    </button>
                </section>

                <section style={cardStyle}>
                    <div>
                        <h3 style={{ color: '#34d399', fontSize: '24px', margin: '0 0 14px 0', fontWeight: '900' }}>{practicalTitle}</h3>
                        <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>
                            {practicalDesc}
                        </p>
                    </div>
                    <button
                        type="button" onClick={() => navigate('/cert/ipe/practical')}
                        style={{ ...buttonStyle, background: '#10b981', marginTop: '20px' }}
                    >
                        {practicalButton}
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
