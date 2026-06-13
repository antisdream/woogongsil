// Practical-exam feature module for IpepImageViewer.
import React from 'react';
import { baseButtonStyle } from './ipepPracticeStyles.js';

function IpepImageViewer({ imageViewer, imageZoom, setImageZoom, closeImageViewer }) {
        if (!imageViewer) return null;

        return (
            <div
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
                            <button type="button" onClick={() => setImageZoom(prev => Math.max(0.75, Number((prev - 0.25).toFixed(2))))} style={{ ...baseButtonStyle, padding: '8px 10px', background: 'var(--wgs-button-muted)' }}>축소</button>
                            <button type="button" onClick={() => setImageZoom(1)} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#64748b' }}>{Math.round(imageZoom * 100)}%</button>
                            <button type="button" onClick={() => setImageZoom(prev => Math.min(3, Number((prev + 0.25).toFixed(2))))} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#3b82f6' }}>확대</button>
                            <button type="button" onClick={() => window.open(imageViewer.src, '_blank', 'noopener,noreferrer')} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#10b981' }}>새 창</button>
                            <button type="button" onClick={closeImageViewer} style={{ ...baseButtonStyle, padding: '8px 10px', background: '#ef4444' }}>닫기</button>
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
