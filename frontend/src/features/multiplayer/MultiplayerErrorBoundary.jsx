// 멀티플레이 시험 기능 모듈입니다: MultiplayerErrorBoundary
import React from 'react';
import { buttonStyle, errorNoticeStyle, noticeStyle, pageStyle, titleStyle } from './multiplayerStyles.js';

class MultiplayerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || '알 수 없는 화면 오류가 발생했습니다.' };
  }

  componentDidCatch(error, info) {
    console.error('[multiplayer page render error]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>랜덤 CBT 멀티플레이</h1>
        <div style={{ ...noticeStyle, ...errorNoticeStyle }}>
          멀티플레이 시험 화면을 여는 중 오류가 발생했습니다: {this.state.errorMessage}
        </div>
        <p style={{ lineHeight: 1.8, color: 'var(--mp-text)' }}>
          브라우저를 새로고침한 뒤 다시 시도해 주세요. 같은 오류가 반복되면 F12 Console의 빨간 오류 메시지를 확인해야 합니다.
        </p>
        <button type="button" style={buttonStyle} onClick={() => window.location.assign('/multiplayer')}>멀티플레이 로비 다시 열기</button>
      </div>
    );
  }
}

export default MultiplayerErrorBoundary;
