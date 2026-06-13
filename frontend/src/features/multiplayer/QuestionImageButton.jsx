// 멀티플레이 시험 기능 모듈입니다: QuestionImageButton
import React from 'react';
import { getQuestionImageSrc } from './multiplayerExamUtils.js';

function QuestionImageButton({ question, currentIndex, getScratchStorageKey, setImagePreview }) {
    const src = getQuestionImageSrc(question);
    if (!src) return null;

    return (
        <div className="mp-question-image-wrap">
            <button
                type="button" className="mp-image-open-btn" onClick={() => setImagePreview({
                    src,
                    alt: '문제 보기 이미지 확대',
                    scratchKey: getScratchStorageKey(question, currentIndex),
                    questionLabel: `${currentIndex + 1}번 문제`,
                })}
                title="문제 보기 이미지를 크게 보기"
            >
                <img
                    src={src}
                    alt="문제 보기 이미지" className="mp-question-image"
                />
                <span className="mp-image-open-label">사진 확대</span>
            </button>
        </div>
    );
}

export default QuestionImageButton;
