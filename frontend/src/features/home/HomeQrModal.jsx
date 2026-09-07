// Home page feature module for HomeQrModal.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function HomeQrModal({
    open,
    onClose,
    qrUrl,
    currentUrl,
    detectedServerIp,
    customIp,
    setCustomIp,
    mobileQrTitle,
    mobileQrDesc,
    mobileQrUrlLabel,
    mobileQrDetectedIpLabel,
    mobileQrDetectingLabel,
    mobileQrWifiHint,
    mobileQrChangeLabel,
    mobileQrPlaceholder,
}) {
    const qrImageUrls = useMemo(() => (Array.isArray(qrUrl) ? qrUrl : [qrUrl]).filter(Boolean), [qrUrl]);
    const [qrImageIndex, setQrImageIndex] = useState(0);
    const dialog = useRef(null);
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialog.current?.querySelector('button')?.focus();
        const keydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); close.current(); }
            if (event.key !== 'Tab') return;
            const nodes = [...dialog.current.querySelectorAll('button,input,a[href]')].filter((node) => !node.disabled && node.getClientRects().length);
            if (!nodes.length) return;
            const first = nodes[0]; const last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
    }, [open]);

    useEffect(() => {
        setQrImageIndex(0);
    }, [qrImageUrls]);

    if (!open) return null;

    const qrImageSrc = qrImageUrls[Math.min(qrImageIndex, Math.max(qrImageUrls.length - 1, 0))] || '';
    const handleQrImageError = () => {
        setQrImageIndex((prev) => (prev + 1 < qrImageUrls.length ? prev + 1 : prev));
    };

    let localAddress = false;
    try { const host = new URL(currentUrl).hostname; localAddress = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host); } catch { /* Existing URL is displayed for correction. */ }
    return createPortal(<div className="ui-qr-backdrop">
        <section ref={dialog} className="ui-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-qr-title">
            <button type="button" className="ui-secondary ui-qr-close" onClick={onClose} aria-label="모바일 접속 팝업 닫기">닫기</button>
            <h2 id="ui-qr-title">{mobileQrTitle}</h2>
            <p>{localAddress ? mobileQrDesc : '휴대폰 카메라로 QR을 스캔해 같은 사이트를 열어보세요.'}</p>
            <div className="ui-qr-image"><img src={qrImageSrc} alt="모바일 접속 주소 QR 코드" onError={handleQrImageError} /></div>
            <p className="ui-qr-address">{mobileQrUrlLabel}<strong>{currentUrl}</strong></p>
            {localAddress && <p>{mobileQrDetectedIpLabel} {detectedServerIp || mobileQrDetectingLabel}<br />{mobileQrWifiHint}</p>}
            <details className="ui-qr-advanced"><summary>로컬 접속 주소 설정</summary><label>{mobileQrChangeLabel}<input type="text" value={customIp} onChange={(e) => setCustomIp(e.target.value)} placeholder={mobileQrPlaceholder} /></label></details>
        </section>
    </div>, document.body);
}
