// 필기 로비 라우트 페이지 컴포넌트입니다.
import React from 'react';
import { useNavigate } from 'react-router-dom';

import useScreenSettings from '../useScreenSettings';

// 필기 로비 화면 구성
// 역할:
// 1. 필기문제 메뉴에서 들어오는 필기 학습 로비 화면입니다.
// 2. 실제 문제은행/기출문제 화면은 기존 컴포넌트를 유지하되, 주소는 /cert/ipe 하위로 연결합니다.
// 3. 멀티플레이는 /multiplayer 독립 메뉴로 분리했기 때문에 이 화면에서는 제거합니다.
// 4. 관리자페이지 > 화면 설정 관리에서 쓰던 필기문제 문구 연결은 유지합니다.
// 5. 백엔드, DB, 달력, 실기 로직은 유지합니다.

const cardStyle = {
    boxSizing: 'border-box',
    background: 'var(--wgs-card)',
    border: '1px solid var(--wgs-border)',
    borderRadius: '14px',
    padding: '24px',
    minHeight: '230px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxShadow: '0 10px 25px rgba(0,0,0,0.22)'
};

const buttonStyle = {
    width: '100%',
    padding: '14px 18px',
    borderRadius: '10px',
    border: 'none',
    color: 'white',
    fontWeight: '900',
    fontSize: '16px',
    cursor: 'pointer'
};

function WrittenLobby() {
    const navigate = useNavigate();

    // 관리자페이지에서 필기문제 페이지 제목/문구를 수정할 수 있게 기존 연결은 유지합니다.
    // 값이 없을 때는 두 번째 인자의 기본 문구가 화면에 표시됩니다.
    const { getSetting: getWrittenScreenSetting } = useScreenSettings('written');

    const writtenLobbyTitle = getWrittenScreenSetting('lobby.page_title', '정보처리기사 필기문제');
    const writtenLobbyDesc = getWrittenScreenSetting(
        'lobby.page_desc',
        '필기 문제은행과 필기 기출문제를 선택할 수 있습니다.'
    );
    const writtenRandomTitle = getWrittenScreenSetting('cards.random_title', '필기 문제은행');
    const writtenPastTitle = getWrittenScreenSetting('cards.past_title', '필기 기출문제');

    return (
        <div
            className="written-lobby-page exam-page wgs-typography-scope" style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--wgs-card)',
                border: '1px solid var(--wgs-border)',
                borderRadius: '14px',
                padding: '30px'
            }}
        >
            <h2
                className="wgs-page-title" style={{
                    color: 'var(--wgs-title)',
                    fontSize: '28px',
                    margin: '0 0 12px 0'
                }}
            >
                 {writtenLobbyTitle}
            </h2>

            <p
                style={{
                    color: 'var(--wgs-muted)',
                    lineHeight: 1.7,
                    margin: '0 0 24px 0'
                }}
            >
                {writtenLobbyDesc}
                <br />
                멀티플레이는 상단의 “멀티플레이” 메뉴에서 별도로 이용할 수 있습니다.
            </p>

            <div
                className="written-lobby-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '18px'
                }}
            >
                {/*  필기 문제은행 카드
                    기존 RandomPractice 화면을 /cert/ipe/written-bank 주소에서 그대로 사용합니다.
                    랜덤 문제 풀이 기능 자체는 수정하지 않습니다. */}
                <section style={cardStyle}>
                    <div>
                        <h3
                            style={{
                                color: '#fcd34d',
                                fontSize: '22px',
                                margin: '0 0 12px 0'
                            }}
                        >
                             {writtenRandomTitle}
                        </h3>

                        <p
                            style={{
                                color: 'var(--wgs-muted)',
                                lineHeight: 1.7,
                                margin: 0
                            }}
                        >
                            과목별 랜덤 문제를 풀면서 개념을 빠르게 확인하는 학습모드입니다.
                            <br />
                            답안을 제출하면 즉시 채점 결과와 정답을 확인할 수 있습니다.
                        </p>
                    </div>

                    <button
                        type="button" onClick={() => navigate('/cert/ipe/written-bank')}
                        style={{
                            ...buttonStyle,
                            background: '#3b82f6',
                            marginTop: '20px'
                        }}
                    >
                        문제은행 입장하기
                    </button>
                </section>

                {/*  필기 기출문제 카드
                    기존 PastExam 화면을 /cert/ipe/written-past 주소에서 그대로 사용합니다.
                    제한시간, OMR, 결과표, PDF 출력 로직은 수정하지 않습니다. */}
                <section style={cardStyle}>
                    <div>
                        <h3
                            style={{
                                color: '#fcd34d',
                                fontSize: '22px',
                                margin: '0 0 12px 0'
                            }}
                        >
                             {writtenPastTitle}
                        </h3>

                        <p
                            style={{
                                color: 'var(--wgs-muted)',
                                lineHeight: 1.7,
                                margin: 0
                            }}
                        >
                            연도와 회차를 선택해 실제 시험처럼 풀 수 있는 모드입니다.
                            <br />
                            제한시간, OMR 이동, 최종 결과표, PDF 출력 기능을 제공합니다.
                        </p>
                    </div>

                    <button
                        type="button" onClick={() => navigate('/cert/ipe/written-past')}
                        style={{
                            ...buttonStyle,
                            background: '#10b981',
                            marginTop: '20px'
                        }}
                    >
                        기출문제 입장하기
                    </button>
                </section>
            </div>

            {/*  멀티플레이 분리 안내
                사용자가 필기문제 페이지에서 멀티플레이가 사라진 이유를 이해할 수 있게 짧게 안내합니다. */}
            <div
                style={{
                    marginTop: '22px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'var(--wgs-card)',
                    border: '1px solid var(--wgs-border)',
                    color: 'var(--wgs-subtle)',
                    lineHeight: 1.6
                }}
            >
                 랜덤 CBT 멀티플레이는 상단 ‘멀티플레이’ 메뉴에서 이용할 수 있습니다.
                <br />
                필기 문제은행과 필기 기출문제 기능은 동일하게 이용할 수 있습니다.
            </div>
        </div>
    );
}

export default WrittenLobby;
