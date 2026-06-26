import React, { useMemo, useState } from 'react';
import { IPEP_SPECIAL_SYMBOL_PAGES } from './ipepSpecialSymbols.js';
import { baseButtonStyle } from './ipepPracticeStyles.js';

const panelStyle = {
    marginTop: '10px',
    border: '1px solid var(--wgs-border)',
    borderRadius: '10px',
    background: 'var(--wgs-input-bg)',
    padding: '10px',
};

const symbolButtonStyle = {
    minWidth: '44px',
    minHeight: '44px',
    border: '1px solid var(--wgs-border)',
    borderRadius: '8px',
    background: 'var(--wgs-exam-card)',
    color: 'var(--wgs-text)',
    fontSize: '18px',
    fontWeight: 900,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 8px',
    whiteSpace: 'nowrap',
};

function clampPage(page, pageCount) {
    if (pageCount <= 0) return 0;
    return Math.min(Math.max(page, 0), pageCount - 1);
}

export default function IpepSpecialSymbolPad({
    textareaRef,
    value,
    onChange,
    toggleOpenLabel = '특수기호 열기',
    toggleCloseLabel = '특수기호 닫기',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [pageIndex, setPageIndex] = useState(0);
    const pages = useMemo(() => IPEP_SPECIAL_SYMBOL_PAGES.filter((page) => page.length > 0), []);
    const pageCount = pages.length;
    const safePageIndex = clampPage(pageIndex, pageCount);
    const currentPage = pages[safePageIndex] || [];

    const insertSymbol = (symbol) => {
        const textarea = textareaRef?.current;
        const currentValue = String(value ?? '');
        const start = typeof textarea?.selectionStart === 'number' ? textarea.selectionStart : currentValue.length;
        const end = typeof textarea?.selectionEnd === 'number' ? textarea.selectionEnd : start;
        const nextValue = `${currentValue.slice(0, start)}${symbol}${currentValue.slice(end)}`;
        onChange(nextValue);

        window.requestAnimationFrame(() => {
            if (!textareaRef?.current) return;
            const nextPosition = start + symbol.length;
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(nextPosition, nextPosition);
        });
    };

    if (pageCount === 0) return null;

    return (
        <div style={{ marginTop: '10px' }}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                style={{ ...baseButtonStyle, width: '100%', background: 'var(--wgs-button-muted)', border: '1px solid #3b82f6' }}
            >
                {isOpen ? toggleCloseLabel : toggleOpenLabel}
            </button>

            {isOpen && (
                <div style={panelStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                        <button
                            type="button"
                            onClick={() => setPageIndex((prev) => clampPage(prev - 1, pageCount))}
                            disabled={safePageIndex === 0}
                            style={{ ...baseButtonStyle, minWidth: '52px', padding: '10px 12px', background: 'var(--wgs-button-muted)', opacity: safePageIndex === 0 ? 0.5 : 1 }}
                        >
                            &lt;
                        </button>
                        <strong style={{ color: 'var(--wgs-text)', fontSize: '16px', minWidth: '64px', textAlign: 'center' }}>
                            {safePageIndex + 1} / {pageCount}
                        </strong>
                        <button
                            type="button"
                            onClick={() => setPageIndex((prev) => clampPage(prev + 1, pageCount))}
                            disabled={safePageIndex === pageCount - 1}
                            style={{ ...baseButtonStyle, minWidth: '52px', padding: '10px 12px', background: 'var(--wgs-button-muted)', opacity: safePageIndex === pageCount - 1 ? 0.5 : 1 }}
                        >
                            &gt;
                        </button>
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))',
                            gap: '8px',
                        }}
                    >
                        {currentPage.map((symbol) => (
                            <button
                                key={symbol}
                                type="button"
                                aria-label={`insert ${symbol}`}
                                onClick={() => insertSymbol(symbol)}
                                style={symbolButtonStyle}
                            >
                                {symbol}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
