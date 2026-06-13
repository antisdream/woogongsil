// Shared UI component used across frontend pages.
import React, { useEffect, useRef, useState } from 'react';

// WGS hCaptcha 공용 컴포넌트
// ------------------------------------------------------------
// - 별도 npm 패키지 없이 hCaptcha 공식 스크립트를 직접 로드합니다.
// - 환경 변수 파일에서 HCAPTCHA_ENABLED=false 이거나 키가 없으면 자동으로 숨겨집니다.
// - 토큰은 1회성이라 API 요청 후 resetKey를 올려 다시 풀게 만들 수 있습니다.
const HCAPTCHA_SCRIPT_ID = 'wgs-hcaptcha-script';
const HCAPTCHA_SCRIPT_SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit';

function loadHcaptchaScript() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);

  const existingScript = document.getElementById(HCAPTCHA_SCRIPT_ID);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(window.hcaptcha), { once: true });
      existingScript.addEventListener('error', reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = HCAPTCHA_SCRIPT_ID;
    script.src = HCAPTCHA_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.hcaptcha);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function HCaptchaBox({
  actionLabel = '보안 확인',
  onTokenChange,
  onEnabledChange,
  resetKey = 0,
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState('');
  const [message, setMessage] = useState('보안 확인 정보를 불러오는 중입니다.');

  useEffect(() => {
    let alive = true;

    fetch('/api/gatekeeper/hcaptcha-config', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        const nextEnabled = Boolean(data?.enabled && data?.siteKey);
        setEnabled(nextEnabled);
        setSiteKey(data?.siteKey || '');
        setMessage(nextEnabled ? '보안 확인을 완료해주세요.' : '');
        onEnabledChange?.(nextEnabled);
      })
      .catch(() => {
        if (!alive) return;
        setEnabled(false);
        setSiteKey('');
        setMessage('');
        onEnabledChange?.(false);
      });

    return () => { alive = false; };
  }, [onEnabledChange]);

  useEffect(() => {
    if (!enabled || !siteKey || !containerRef.current) return;
    let alive = true;

    loadHcaptchaScript()
      .then((hcaptcha) => {
        if (!alive || !hcaptcha || !containerRef.current) return;
        if (widgetIdRef.current !== null) return;

        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
        widgetIdRef.current = hcaptcha.render(containerRef.current, {
          sitekey: siteKey,
          theme: prefersDark ? 'dark' : 'light',
          callback: (token) => {
            setMessage('보안 확인 완료');
            onTokenChange?.(token || '');
          },
          'expired-callback': () => {
            setMessage('보안 확인 시간이 만료되었습니다. 다시 체크해주세요.');
            onTokenChange?.('');
          },
          'error-callback': () => {
            setMessage('보안 확인 중 오류가 발생했습니다. 로컬 테스트라면 hCaptcha 사이트키 허용 도메인에 localhost/127.0.0.1이 포함되어 있는지 확인해주세요.');
            onTokenChange?.('');
          },
        });
      })
      .catch(() => {
        setMessage('hCaptcha 스크립트를 불러오지 못했습니다. 네트워크를 확인해주세요.');
        onTokenChange?.('');
      });

    return () => { alive = false; };
  }, [enabled, siteKey, onTokenChange]);

  useEffect(() => {
    if (!enabled || widgetIdRef.current === null || !window.hcaptcha) return;
    try {
      window.hcaptcha.reset(widgetIdRef.current);
    } catch (error) {
      // hCaptcha 위젯이 이미 제거된 경우 기존 기능이 멈추지 않도록 무시합니다.
    }
    setMessage('보안 확인을 완료해주세요.');
    onTokenChange?.('');
  }, [resetKey, enabled, onTokenChange]);

  if (!enabled) return null;

  return (
    <div className={`wgs-hcaptcha-box ${className}`.trim()}>
      <div className="wgs-hcaptcha-title"> {actionLabel}</div>
      <div ref={containerRef} className="wgs-hcaptcha-widget" />
      {message && <div className="wgs-hcaptcha-message">{message}</div>}
    </div>
  );
}

// localhost 경고는 hCaptcha 사이트키의 허용 도메인 설정과 관련될 수 있습니다.
