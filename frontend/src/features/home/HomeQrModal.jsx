// Home page feature module for HomeQrModal.
import React, { useEffect, useMemo, useState } from 'react';

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

    useEffect(() => {
        setQrImageIndex(0);
    }, [qrImageUrls]);

    if (!open) return null;

    const qrImageSrc = qrImageUrls[Math.min(qrImageIndex, Math.max(qrImageUrls.length - 1, 0))] || '';
    const handleQrImageError = () => {
        setQrImageIndex((prev) => (prev + 1 < qrImageUrls.length ? prev + 1 : prev));
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
            <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '30px', borderRadius: '12px', border: '2px solid #10b981', textAlign: 'center', position: 'relative', maxWidth: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', animation: 'fadeIn 0.2s' }}>
                <button onClick={onClose} aria-label="모바일 접속 팝업 닫기" style={{ position: 'absolute', top: '10px', right: '15px', background: 'transparent', border: 'none', color: 'var(--wgs-muted)', fontSize: '14px', cursor: 'pointer', fontWeight: 'bold' }}>닫기</button>
                <h3 style={{ color: '#fcd34d', margin: '0 0 10px 0', fontSize: '22px' }}>{mobileQrTitle}</h3>
                <p style={{ fontSize: '14px', color: 'var(--wgs-subtle)', marginBottom: '20px' }}>{mobileQrDesc}</p>

                <div style={{ background: 'white', padding: '15px', borderRadius: '10px', display: 'inline-block', marginBottom: '15px' }}>
                    <img src={qrImageSrc} alt="Mobile QR Code" onError={handleQrImageError} style={{ display: 'block' }} />
                </div>

                <div style={{ fontSize: '14px', color: 'var(--wgs-muted)', marginBottom: '10px' }}>
                    {mobileQrUrlLabel} <strong style={{ color: '#fcd34d', fontSize: '16px' }}>{currentUrl}</strong>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--wgs-subtle)', marginBottom: '15px', lineHeight: 1.5 }}>
                    {mobileQrDetectedIpLabel} {detectedServerIp || mobileQrDetectingLabel}<br />
                    {mobileQrWifiHint}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--wgs-subtle)' }}>{mobileQrChangeLabel}</span>
                    <input
                        type="text" value={customIp}
                        onChange={(e) => setCustomIp(e.target.value)}
                        placeholder={mobileQrPlaceholder}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-button-muted)', color: 'white', width: '170px' }}
                    />
                </div>
            </div>
        </div>
    );
}
