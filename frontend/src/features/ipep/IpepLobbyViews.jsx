// Practical-exam feature module for IpepLobbyViews.
import React from 'react';
import WgsIpepSettingLines from './IpepSettingLines.jsx';
import {
    baseButtonStyle,
    ipepLobbyButtonStyle,
    ipepLobbyCardStyle,
    ipepLobbyNoticeStyle,
    ipepLobbyTextStyle,
    ipepLobbyTitleStyle,
    panelStyle,
} from './ipepPracticeStyles.js';

export function IpepGuide() {
        return (
            <section style={{ ...panelStyle, marginBottom: '18px' }}>
                <h3 style={{ color: '#38bdf8', fontSize: '22px', margin: '0 0 14px 0' }}>답안 작성 가이드</h3>
                <ul style={{ color: 'var(--wgs-muted)', lineHeight: 1.9, margin: 0, paddingLeft: '20px' }}>
                    <li>용어형: 영어 대소문자, 앞뒤 공백, 일부 문장부호는 완화하여 채점합니다.</li>
                    <li>여러 답안형: 쉼표(,) 또는 줄바꿈으로 구분하여 입력합니다. 예: 원자성, 독립성</li>
                    <li>SQL형: 대소문자와 불필요한 공백은 완화하지만 SQL 문법 기호는 정확히 작성해야 합니다.</li>
                    <li>코드 출력형: 대소문자, 공백, 줄바꿈이 중요하므로 출력 결과를 최대한 정확히 입력해야 합니다.</li>
                    <li>긴 서술형: 자동채점이 어려운 문항은 최종 제출 시 정답 예시를 보고 직접 맞음/틀림을 선택합니다.</li>
                </ul>
            </section>
        );
    
}

export function IpepLobby({
    goIpepMode,
    ipepRandomCardTitle,
    ipepRandomCardDesc,
    ipepRandomButtonLabel,
    ipepPastCardTitle,
    ipepPastCardDesc,
    ipepPastButtonLabel,
    ipepGuideText,
}) {
        return (
            <>
                <div
                    className="ipep-lobby-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}
                >
                    <article style={ipepLobbyCardStyle}>
                        <div>
                            {/* 필기 로비와 동일한 제목 크기/색상 기준을 적용하되, 실기 로비 문구는 그대로 유지합니다. */}
                            <h3 style={ipepLobbyTitleStyle}>{ipepRandomCardTitle}</h3>
                            <p style={ipepLobbyTextStyle}>
                                <WgsIpepSettingLines text={ipepRandomCardDesc} />
                            </p>
                        </div>
                        <button
                            onClick={() => goIpepMode('random')}
                            style={{ ...ipepLobbyButtonStyle, background: '#3b82f6' }}
                        >
                            {ipepRandomButtonLabel}
                        </button>
                    </article>

                    <article style={ipepLobbyCardStyle}>
                        <div>
                            {/* 필기 로비와 동일한 제목 크기/색상 기준을 적용하되, 실기 로비 문구는 그대로 유지합니다. */}
                            <h3 style={ipepLobbyTitleStyle}>{ipepPastCardTitle}</h3>
                            <p style={ipepLobbyTextStyle}>
                                <WgsIpepSettingLines text={ipepPastCardDesc} />
                            </p>
                        </div>
                        <button
                            onClick={() => goIpepMode('past')}
                            style={{ ...ipepLobbyButtonStyle, background: '#10b981' }}
                        >
                            {ipepPastButtonLabel}
                        </button>
                    </article>
                </div>

                {/* 안내 박스도 필기 로비의 가독성 기준과 맞춰 모드 전환 시 색/줄간격이 흔들리지 않도록 고정합니다. */}
                <div style={ipepLobbyNoticeStyle}>
                    <WgsIpepSettingLines text={ipepGuideText} />
                </div>
            </>
        );
    
}

export function IpepModeButtons({ mode, goIpepMode }) {
        return (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <button
                    onClick={() => goIpepMode('lobby')}
                    style={{ ...baseButtonStyle, background: 'var(--wgs-button-muted)' }}
                >
                    실기 로비
                </button>
                <button
                    onClick={() => goIpepMode('random')}
                    style={{ ...baseButtonStyle, background: mode === 'random'? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                     실기 문제은행
                </button>
                <button
                    onClick={() => goIpepMode('past')}
                    style={{ ...baseButtonStyle, background: mode === 'past'? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                     실기 기출문제
                </button>
            </div>
        );
    
}
