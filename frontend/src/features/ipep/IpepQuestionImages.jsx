// Practical-exam feature module for IpepQuestionImages.
import React from 'react';
import {
    getImgSrc,
    getQuestionChoiceImgPath,
    getQuestionExplanationImgPath,
} from './ipepPracticeUtils.js';
import { baseButtonStyle } from './ipepPracticeStyles.js';

export function IpepQuestionImages({ question, openImageViewer }) {
        if (!question) return null;

        const choiceImgPath = getQuestionChoiceImgPath(question);
        if (!choiceImgPath) return null;

        return (
            <div style={{ margin: '18px 0', textAlign: 'center' }}>
                <img
                    src={getImgSrc(choiceImgPath)}
                    alt="보기 이미지" style={{
                        maxWidth: '100%',
                        maxHeight: '420px',
                        borderRadius: '8px',
                        border: '1px solid var(--wgs-border)',
                        background: '#ffffff'
                    }}
                    onClick={() => openImageViewer(choiceImgPath, '보기 이미지 크게 보기')}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <div style={{ marginTop: '8px' }}>
                    <button
                        type="button" onClick={() => openImageViewer(choiceImgPath, '보기 이미지 크게 보기')}
                        style={{ ...baseButtonStyle, padding: '8px 12px', background: 'var(--wgs-button-muted)', fontSize: '13px' }}
                    >
                         보기 이미지 크게 보기
                    </button>
                </div>
            </div>
        );
    
}

export function IpepExplanationImage({ question, openImageViewer }) {
        if (!question) return null;

        const explanationImgPath = getQuestionExplanationImgPath(question);
        if (!explanationImgPath) return null;

        return (
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--wgs-border)' }}>
                <div style={{ color: 'var(--wgs-title)', fontWeight: '900', marginBottom: '10px', textAlign: 'left' }}>
                     해설 이미지
                </div>
                <div style={{ maxHeight: '520px', overflow: 'auto', textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '10px', border: '1px solid var(--wgs-border)' }}>
                    <img
                        src={getImgSrc(explanationImgPath)}
                        alt="해설 이미지" style={{
                            maxWidth: '100%',
                            height: 'auto',
                            borderRadius: '8px',
                            border: '1px solid var(--wgs-border)',
                            background: '#ffffff'
                        }}
                        onClick={() => openImageViewer(explanationImgPath, '해설 이미지 크게 보기')}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>
                <button
                    type="button" onClick={() => openImageViewer(explanationImgPath, '해설 이미지 크게 보기')}
                    style={{ ...baseButtonStyle, width: '100%', marginTop: '10px', background: '#8b5cf6' }}
                >
                     해설 이미지 확대해서 보기
                </button>
            </div>
        );
    
}
