// Practical-exam feature module for IpepLobbyViews.
import React from 'react';
import { FiBookOpen, FiClipboard, FiCalendar, FiArrowRight } from 'react-icons/fi';
import WgsIpepSettingLines from './IpepSettingLines.jsx';
import {
    baseButtonStyle,
    compactPanelStyle,
    ipepLobbyButtonStyle,
    ipepLobbyCardStyle,
    ipepLobbyNoticeStyle,
    ipepLobbyTextStyle,
    ipepLobbyTitleStyle,
    mutedTextStyle,
} from './ipepPracticeStyles.js';

export function IpepGuide({
    guideTitle = '답안 작성 가이드',
    guideText = '용어형: 영어 대소문자, 앞뒤 공백, 일부 문장부호는 완화하여 채점합니다.\n여러 답안형: 쉼표(,) 또는 줄바꿈으로 구분하여 입력합니다. 예: 원자성, 독립성\nSQL형: 대소문자와 불필요한 공백은 완화하지만 SQL 문법 기호는 정확히 작성해야 합니다.\n코드 출력형: 대소문자, 공백, 줄바꿈이 중요하므로 출력 결과를 최대한 정확히 입력해야 합니다.\n긴 서술형: 자동채점이 어려운 문항은 최종 제출 시 정답 예시를 보고 직접 맞음/틀림을 선택합니다.'
}) {
        const guideItems = String(guideText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

        return (
            <details className="ipep-guide-details" style={{ ...compactPanelStyle, marginBottom: '14px' }}>
                <summary style={{ color: '#38bdf8', fontSize: '18px', fontWeight: 900, cursor: 'pointer', lineHeight: 1.4 }}>
                    {guideTitle}
                </summary>
                <ul style={{ ...mutedTextStyle, lineHeight: 1.8, margin: '12px 0 0 0', paddingLeft: '20px' }}>
                    {guideItems.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                </ul>
            </details>
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
    ipepThreeWeekCardTitle = '3주 공략',
    ipepThreeWeekCardDesc = '3주 커리큘럼에 맞춰 Section별 실기 문제를 섹션순 또는 랜덤 정렬로 풀 수 있습니다.',
    ipepThreeWeekButtonLabel = '3주 공략 입장하기',
    ipepGuideText,
}) {
        return (
            <>
                <div
                    className="ipep-lobby-grid learning-mode-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}
                >
                    <article className="learning-mode-card" style={ipepLobbyCardStyle}>
                        <div>
                            {/* 필기 로비와 동일한 제목 크기/색상 기준을 적용하되, 실기 로비 문구는 그대로 유지합니다. */}
                            <span className="learning-mode-icon" aria-hidden="true"><FiBookOpen /></span>
                            <h3 style={ipepLobbyTitleStyle}>{ipepRandomCardTitle}</h3>
                            <p style={ipepLobbyTextStyle}>
                                <WgsIpepSettingLines text={ipepRandomCardDesc} />
                            </p>
                        </div>
                        <button className="learning-primary"
                            onClick={() => goIpepMode('random')}
                            style={{ ...ipepLobbyButtonStyle, background: '#3b82f6' }}
                        >
                            {ipepRandomButtonLabel}<FiArrowRight aria-hidden="true" />
                        </button>
                    </article>

                    <article className="learning-mode-card" style={ipepLobbyCardStyle}>
                        <div>
                            {/* 필기 로비와 동일한 제목 크기/색상 기준을 적용하되, 실기 로비 문구는 그대로 유지합니다. */}
                            <span className="learning-mode-icon" aria-hidden="true"><FiClipboard /></span>
                            <h3 style={ipepLobbyTitleStyle}>{ipepPastCardTitle}</h3>
                            <p style={ipepLobbyTextStyle}>
                                <WgsIpepSettingLines text={ipepPastCardDesc} />
                            </p>
                        </div>
                        <button className="learning-primary"
                            onClick={() => goIpepMode('past')}
                            style={{ ...ipepLobbyButtonStyle, background: '#10b981' }}
                        >
                            {ipepPastButtonLabel}<FiArrowRight aria-hidden="true" />
                        </button>
                    </article>

                    <article className="learning-mode-card" style={ipepLobbyCardStyle}>
                        <div>
                            <span className="learning-mode-icon" aria-hidden="true"><FiCalendar /></span>
                            <h3 style={ipepLobbyTitleStyle}>{ipepThreeWeekCardTitle}</h3>
                            <p style={ipepLobbyTextStyle}>
                                <WgsIpepSettingLines text={ipepThreeWeekCardDesc} />
                            </p>
                        </div>
                        <button className="learning-primary"
                            onClick={() => goIpepMode('threeWeek')}
                            style={{ ...ipepLobbyButtonStyle, background: '#f59e0b' }}
                        >
                            {ipepThreeWeekButtonLabel}<FiArrowRight aria-hidden="true" />
                        </button>
                    </article>
                </div>

                {/* 안내 박스도 필기 로비의 가독성 기준과 맞춰 모드 전환 시 색/줄간격이 흔들리지 않도록 고정합니다. */}
                <div className="learning-note" style={ipepLobbyNoticeStyle}>
                    <WgsIpepSettingLines text={ipepGuideText} />
                </div>
            </>
        );
    
}

export function IpepModeButtons({
    mode,
    goIpepMode,
    lobbyButtonLabel = '실기 로비',
    randomButtonLabel = '실기 문제은행',
    pastButtonLabel = '실기 기출문제',
    threeWeekButtonLabel = '3주 공략',
}) {
        return (
            <div
                className="ipep-mode-switcher" style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', overflowX: 'auto', marginBottom: '14px', paddingBottom: '2px' }}
            >
                <button className="learning-secondary"
                    type="button"
                    onClick={() => goIpepMode('lobby')}
                    style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: 'var(--wgs-button-muted)' }}
                >
                    {lobbyButtonLabel}
                </button>
                <button className="learning-secondary"
                    type="button"
                    onClick={() => goIpepMode('random')}
                    aria-pressed={mode === 'random'}
                    style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: mode === 'random'? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                     {randomButtonLabel}
                </button>
                <button className="learning-secondary"
                    type="button"
                    onClick={() => goIpepMode('past')}
                    aria-pressed={mode === 'past'}
                    style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: mode === 'past'? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                     {pastButtonLabel}
                </button>
                <button className="learning-secondary"
                    type="button"
                    onClick={() => goIpepMode('threeWeek')}
                    aria-pressed={mode === 'threeWeek'}
                    style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: mode === 'threeWeek'? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                     {threeWeekButtonLabel}
                </button>
            </div>
        );
    
}
