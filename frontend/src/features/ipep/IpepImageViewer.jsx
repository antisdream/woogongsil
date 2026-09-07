// Practical-exam feature module for IpepImageViewer.
import React, { useEffect, useRef } from 'react';
import { baseButtonStyle } from './ipepPracticeStyles.js';

function IpepImageViewer({
    imageViewer,
    imageZoom,
    setImageZoom,
    closeImageViewer,
    zoomOutLabel = '축소',
    zoomInLabel = '확대',
    openNewWindowLabel = '새 창',
    closeLabel = '닫기'
}) {
        const dialogRef = useRef(null);
        const closeRef = useRef(closeImageViewer);
        const isOpen = Boolean(imageViewer);

        useEffect(() => { closeRef.current = closeImageViewer; }, [closeImageViewer]);
        useEffect(() => {
            if (!isOpen) return undefined;
            const previousFocus = document.activeElement;
            const dialog = dialogRef.current;
            dialog?.querySelector('button')?.focus();
            const handleKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeRef.current();
                }
                if (event.key === 'Tab') {
                    const controls = [...(dialog?.querySelectorAll('button:not(:disabled), [href], [tabindex="0"]') || [])];
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first?.focus();
                    }
                }
            };
            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
                if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
            };
        }, [isOpen]);
        if (!imageViewer) return null;

        return (
            <div
                className="learning-image-backdrop"
                onClick={closeImageViewer}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(0, 0, 0, 0.78)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px'
                }}
            >
                <div
                    ref={dialogRef}
                    className="learning-image-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-label={imageViewer.title}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        width: 'min(1100px, 96vw)',
                        maxHeight: '92vh',
                        background: 'var(--wgs-card)',
                        border: '1px solid var(--wgs-border)',
                        borderRadius: '16px',
                        boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
                        overflow: 'hidden'
                    }}
                >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--wgs-border)' }}>
                        <strong style={{ color: 'var(--wgs-text)' }}>{imageViewer.title}</strong>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button className="learning-secondary" type="button" onClick={() => setImageZoom(prev => Math.max(0.75, Number((prev - 0.25).toFixed(2))))} style={{ ...baseButtonStyle, padding: '8px 10px', background: 'var(--wgs-button-muted)' }}>{zoomOutLabel}</button>
                            <button className="learning-secondary" type="button" onClick={() => setImageZoom(1)} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#64748b' }}>{Math.round(imageZoom * 100)}%</button>
                            <button className="learning-secondary" type="button" onClick={() => setImageZoom(prev => Math.min(3, Number((prev + 0.25).toFixed(2))))} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#3b82f6' }}>{zoomInLabel}</button>
                            <button className="learning-secondary" type="button" onClick={() => window.open(imageViewer.src, '_blank', 'noopener,noreferrer')} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#10b981' }}>{openNewWindowLabel}</button>
                            <button className="learning-secondary" type="button" onClick={closeImageViewer} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#ef4444' }}>{closeLabel}</button>
                        </div>
                    </div>
                    <div style={{ maxHeight: '78vh', overflow: 'auto', padding: '16px', background: 'var(--wgs-panel)' }}>
                        <img
                            src={imageViewer.src}
                            alt={imageViewer.title}
                            style={{
                                display: 'block',
                                width: `${imageZoom * 100}%`,
                                maxWidth: imageZoom === 1 ? '100%' : 'none',
                                height: 'auto',
                                margin: '0 auto',
                                background: '#ffffff',
                                borderRadius: '8px'
                            }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    </div>
                </div>
            </div>
        );
    
}

export default IpepImageViewer;
