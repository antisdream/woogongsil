// Practical-exam feature module for ipepPracticeStyles.
export const IPEP_TOTAL_SECONDS = 9000; // 2시간 30분 = 150분 = 9000초

// 전역 테마 연동 스타일
// - App.css의 CSS 변수만 참조하므로 다크/라이트 전환 시 이 파일의
// JSX 로직을 변경하지 않아도 화면 색이 함께 바뀝니다.
// - 기존 문제 로딩, 채점, 저장 로직은 그대로 유지합니다.
export const pageBoxStyle = {
    // 실기 페이지 전체가 부모 폭을 넘지 않도록 width/boxSizing을 명시합니다.
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--wgs-panel)',
    border: '1px solid var(--wgs-border)',
    borderRadius: '14px',
    padding: '30px',
    color: 'var(--wgs-text)'
};

export const panelStyle = {
    // 내부 패널도 padding 포함 폭으로 계산해 모바일 화면 넘침을 줄입니다.
    boxSizing: 'border-box',
    background: 'var(--wgs-card)',
    border: '1px solid var(--wgs-border)',
    borderRadius: '12px',
    padding: '20px',
    color: 'var(--wgs-text)'
};

export const baseButtonStyle = {
    border: 'none',
    borderRadius: '9px',
    color: 'white',
    fontWeight: '900',
    cursor: 'pointer',
    padding: '12px 18px',
    fontSize: '15px'
};

// 실기 로비 전용 UI 스타일
// - 필기 로비(WrittenLobby.jsx)의 카드/문구 기준과 맞춰
//  다크모드와 라이트모드에서 글씨 크기, 줄간격, 글씨색이
//  동일한 톤으로 보이도록 정리했습니다.
// - 문제 풀이, 채점, 저장, 기출 응시 로직은 유지합니다.
export const ipepLobbyCardStyle = {
    ...panelStyle,
    minHeight: '210px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    borderRadius: '14px',
    padding: '24px',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.16)'
};

export const ipepLobbyTitleStyle = {
    color: '#facc15',
    fontSize: '22px',
    fontWeight: '900',
    lineHeight: 1.35,
    margin: '0 0 14px 0'
};

export const ipepLobbyTextStyle = {
    color: 'var(--wgs-muted)',
    fontSize: '17px',
    fontWeight: '500',
    lineHeight: 1.75,
    margin: 0
};

export const ipepLobbyButtonStyle = {
    ...baseButtonStyle,
    width: '100%',
    minHeight: '48px',
    marginTop: '20px',
    fontSize: '16px',
    lineHeight: 1.4
};

export const ipepLobbyNoticeStyle = {
    marginTop: '22px',
    padding: '16px',
    borderRadius: '12px',
    background: 'var(--wgs-exam-card)',
    border: '1px solid var(--wgs-border)',
    color: 'var(--wgs-muted)',
    fontSize: '16px',
    fontWeight: '500',
    lineHeight: 1.7
};
