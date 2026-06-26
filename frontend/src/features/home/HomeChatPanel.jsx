// Home page feature module for HomeChatPanel.
import React from 'react';
import {
    CHAT_EMOJI_PRESETS,
    CHAT_GIF_BY_TOKEN,
    CHAT_GIF_PRESETS,
    CHAT_LEGACY_GIF_PREFIX,
    CHAT_RICH_TOKEN_REGEX,
    CHAT_STICKER_BY_TOKEN,
    CHAT_STICKER_PRESETS,
} from './chatPresets.js';

export default function HomeChatPanel({
    chatMessages,
    chatError,
    chatInput,
    setChatInput,
    isChatLoading,
    chatPickerOpen,
    setChatPickerOpen,
    chatPickerTab,
    setChatPickerTab,
    chatLastRefreshedAt,
    sendChatMessage,
    formatChatDateTime,
    openChatPopupWindow,
    liveChatChatTitle,
    liveChatPopupButtonLabel,
    liveChatAutoLabel,
    liveChatResetNotice,
    liveChatEmptyMessage,
    liveChatInputPlaceholder,
    liveChatSendButtonLabel,
    liveChatMeLabel,
    chatPopupNotRefreshedLabel,
}) {
    const appendChatToken = (token) => {
        setChatInput((prev) => {
            const base = prev.trimEnd();
            return base ? `${base} ${token}` : token;
        });
    };

    const renderChatRichToken = (token, key) => {
        const sticker = CHAT_STICKER_BY_TOKEN.get(token);
        const gif = CHAT_GIF_BY_TOKEN.get(token);
        const item = sticker || gif;
        const isGif = Boolean(gif);

        if (!item) return <span key={key}>{token}</span>;

        const motionClassName = isGif ? `wgs-chat-motion-${item.motion || 'bounce'}` : '';

        return (
            <span
                key={key}
                className={isGif ? `wgs-chat-gif-card ${motionClassName}` : 'wgs-chat-sticker-card'}
                style={{
                    '--wgs-chat-media-accent': item.accent,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '9px',
                    maxWidth: '100%',
                    margin: '4px 4px 4px 0',
                    padding: isGif ? '10px 12px' : '8px 11px',
                    borderRadius: '14px',
                    border: `1px solid ${item.accent}88`,
                    background: isGif
                        ? `linear-gradient(135deg, ${item.accent}26, var(--wgs-chat-media-bg-end))`
                        : `linear-gradient(135deg, ${item.accent}1f, var(--wgs-chat-media-bg-end))`,
                    boxShadow: isGif ? `0 0 18px ${item.accent}24` : 'none',
                    verticalAlign: 'middle'
                }}
                title={isGif ? `${item.label} GIF풍 애니메이션` : `${item.label} 스티커`}
            >
                <span
                    className={isGif ? `wgs-chat-gif-icon ${motionClassName}` : 'wgs-chat-sticker-icon'}
                    style={{ fontSize: isGif ? '31px' : '25px', lineHeight: 1 }}
                >
                    {item.icon}
                </span>
                <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
                    <strong style={{ color: 'var(--wgs-chat-media-title)', fontSize: isGif ? '13px' : '12px', whiteSpace: 'nowrap' }}>{item.title}</strong>
                    <span style={{ color: 'var(--wgs-chat-media-sub)', fontSize: '11px', whiteSpace: 'nowrap' }}>{item.message}</span>
                </span>
            </span>
        );
    };

    const renderRichChatContent = (text) => {
        const rawText = String(text || '');
        const parts = rawText.split(CHAT_RICH_TOKEN_REGEX).filter(Boolean);

        if (parts.some((part) => CHAT_STICKER_BY_TOKEN.has(part) || CHAT_GIF_BY_TOKEN.has(part))) {
            return parts.map((part, index) => {
                if (CHAT_STICKER_BY_TOKEN.has(part) || CHAT_GIF_BY_TOKEN.has(part)) {
                    return renderChatRichToken(part, `rich-${index}-${part}`);
                }

                return (
                    <span key={`text-${index}`} style={{ whiteSpace: 'pre-wrap' }}>
                        {part}
                    </span>
                );
            });
        }

        if (rawText.trim().startsWith(CHAT_LEGACY_GIF_PREFIX)) {
            const legacyText = rawText.replace(CHAT_LEGACY_GIF_PREFIX, '').trim() || '움직이는 응원 메시지';
            const legacyItem = {
                label: '메인 GIF 문구',
                icon: '✨',
                title: 'GIF 문구',
                message: legacyText,
                accent: '#60a5fa'
            };

            return (
                <span
                    className="wgs-chat-gif-card wgs-chat-motion-glow"
                    style={{
                        '--wgs-chat-media-accent': legacyItem.accent,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '9px',
                        maxWidth: '100%',
                        margin: '4px 4px 4px 0',
                        padding: '10px 12px',
                        borderRadius: '14px',
                        border: `1px solid ${legacyItem.accent}88`,
                        background: `linear-gradient(135deg, ${legacyItem.accent}26, var(--wgs-chat-media-bg-end))`,
                        boxShadow: `0 0 18px ${legacyItem.accent}24`,
                        verticalAlign: 'middle'
                    }}
                >
                    <span className="wgs-chat-gif-icon wgs-chat-motion-glow" style={{ fontSize: '31px', lineHeight: 1 }}>{legacyItem.icon}</span>
                    <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
                        <strong style={{ color: 'var(--wgs-chat-media-title)', fontSize: '13px', whiteSpace: 'nowrap' }}>{legacyItem.title}</strong>
                        <span style={{ color: 'var(--wgs-chat-media-sub)', fontSize: '11px', whiteSpace: 'normal' }}>{legacyItem.message}</span>
                    </span>
                </span>
            );
        }

        return <span style={{ whiteSpace: 'pre-wrap' }}>{rawText}</span>;
    };

    const renderChatMessageList = (maxHeight = '190px') => (
        <div
            className="wgs-chat-message-list"
            style={{
                flex: 1,
                minHeight: 0,
                maxHeight,
                overflowY: 'auto',
                background: 'var(--wgs-chat-list-bg)',
                border: '1px solid var(--wgs-chat-border)',
                borderRadius: '10px',
                padding: '10px',
                marginBottom: '10px',
                boxSizing: 'border-box'
            }}
        >
            {chatError ? (
                <div style={{ color: 'var(--wgs-chat-error)', fontSize: '13px', textAlign: 'center', padding: '16px 6px' }}>{chatError}</div>
            ) : chatMessages.length === 0 ? (
                <div style={{ color: 'var(--wgs-chat-muted)', fontSize: '13px', textAlign: 'center', padding: '16px 6px' }}>{liveChatEmptyMessage}</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {chatMessages.map((message) => {
                        const isMine = String(message.userId) === String(sessionStorage.getItem('userId'));
                        const isAdminMessage = message.isAdmin === true || message.role === 'admin';
                        return (
                            <div
                                key={message.id}
                                className={`wgs-chat-message-row${isMine ? ' is-mine' : ''}${isAdminMessage ? ' is-admin' : ''}`}
                                style={{
                                    color: 'var(--wgs-chat-text)',
                                    fontSize: '13px',
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    background: isAdminMessage ? 'var(--wgs-chat-message-admin-bg)' : (isMine ? 'var(--wgs-chat-message-mine-bg)' : 'var(--wgs-chat-message-bg)'),
                                    border: isAdminMessage ? '1px solid var(--wgs-chat-message-admin-border)' : (isMine ? '1px solid var(--wgs-chat-message-mine-border)' : '1px solid var(--wgs-chat-message-border)'),
                                    borderRadius: '12px',
                                    padding: '10px 12px'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                                    <span style={{ color: 'var(--wgs-chat-time)', fontSize: '11px', fontWeight: 700, letterSpacing: '-0.01em' }}>
                                        {formatChatDateTime(message.createdAt)}
                                    </span>
                                    <span style={{ color: isAdminMessage ? 'var(--wgs-chat-admin-name)' : (isMine ? 'var(--wgs-chat-mine-name)' : 'var(--wgs-chat-name)'), fontSize: '14px', fontWeight: 900 }}>
                                        {message.userName || message.userId}
                                    </span>
                                    {isAdminMessage && <span className="wgs-chat-admin-badge">관리자</span>}
                                    {isMine && <span style={{ color: 'var(--wgs-action-green)', fontSize: '11px', fontWeight: 800 }}>{liveChatMeLabel}</span>}
                                </div>
                                <div style={{ color: 'var(--wgs-chat-text-strong)', fontSize: '15px', fontWeight: 700, lineHeight: 1.55 }}>
                                    {renderRichChatContent(message.text)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const renderChatPicker = () => {
        if (!chatPickerOpen) return null;

        const tabButtonStyle = (active) => ({
            padding: '7px 10px',
            borderRadius: '999px',
            border: active ? '1px solid rgba(16,185,129,0.65)' : '1px solid var(--wgs-border)',
            background: active ? 'var(--wgs-chat-picker-tab-active-bg)' : 'var(--wgs-chat-picker-tab-bg)',
            color: active ? 'var(--wgs-chat-picker-tab-active-text)' : 'var(--wgs-chat-muted)',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '12px'
        });

        return (
            <div className="wgs-chat-picker" style={{ background: 'var(--wgs-chat-picker-bg)', border: '1px solid var(--wgs-chat-border)', borderRadius: '10px', padding: '10px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <button type="button" onClick={() => setChatPickerTab('emoji')} style={tabButtonStyle(chatPickerTab === 'emoji')}>이모지</button>
                    <button type="button" onClick={() => setChatPickerTab('sticker')} style={tabButtonStyle(chatPickerTab === 'sticker')}>스티커</button>
                    <button type="button" onClick={() => setChatPickerTab('gif')} style={tabButtonStyle(chatPickerTab === 'gif')}>GIF</button>
                </div>

                {chatPickerTab === 'emoji' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 42px))', justifyContent: 'start', alignItems: 'center', gap: '8px', maxHeight: '130px', overflowY: 'auto', overflowX: 'hidden', paddingRight: '2px' }}>
                        {CHAT_EMOJI_PRESETS.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => appendChatToken(emoji)}
                                style={{
                                    width: '42px',
                                    height: '42px',
                                    minWidth: '42px',
                                    minHeight: '42px',
                                    borderRadius: '10px',
                                    border: '1px solid var(--wgs-border)',
                                    background: 'var(--wgs-chat-control-bg)',
                                    color: 'var(--wgs-chat-text-strong)',
                                    cursor: 'pointer',
                                    fontSize: '22px',
                                    lineHeight: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    textAlign: 'center',
                                    padding: 0
                                }}
                                title={`${emoji} 입력`}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', lineHeight: 1 }}>
                                    {emoji}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {chatPickerTab === 'sticker' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: '8px', maxHeight: '170px', overflowY: 'auto' }}>
                        {CHAT_STICKER_PRESETS.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                onClick={() => appendChatToken(item.token)}
                                style={{ textAlign: 'left', borderRadius: '12px', border: `1px solid ${item.accent}77`, background: `linear-gradient(135deg, ${item.accent}1f, var(--wgs-chat-media-bg-end))`, color: 'var(--wgs-chat-media-title)', cursor: 'pointer', padding: '10px', fontSize: '12px', lineHeight: 1.35 }}
                                title="선택하면 입력창에 스티커 토큰이 들어가고, 전송 후 스티커 카드로 표시됩니다."
                            >
                                <span style={{ fontSize: '24px', marginRight: '6px' }}>{item.icon}</span>
                                <strong style={{ color: 'var(--wgs-chat-media-title)' }}>{item.title}</strong><br />
                                <span style={{ color: 'var(--wgs-chat-media-sub)' }}>{item.message}</span>
                            </button>
                        ))}
                    </div>
                )}

                {chatPickerTab === 'gif' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {CHAT_GIF_PRESETS.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                onClick={() => appendChatToken(item.token)}
                                className={`wgs-chat-gif-picker-card wgs-chat-motion-${item.motion || 'bounce'}`}
                                style={{ '--wgs-chat-media-accent': item.accent, textAlign: 'left', borderRadius: '12px', border: `1px solid ${item.accent}88`, background: `linear-gradient(135deg, ${item.accent}26, var(--wgs-chat-media-bg-end))`, color: 'var(--wgs-chat-media-title)', cursor: 'pointer', padding: '10px', fontSize: '12px', lineHeight: 1.35, overflow: 'hidden' }}
                                title="선택하면 입력창에 GIF 토큰이 들어가고, 전송 후 움직이는 카드로 표시됩니다."
                            >
                                <span className={`wgs-chat-gif-icon wgs-chat-motion-${item.motion || 'bounce'}`} style={{ display: 'inline-block', fontSize: '25px', marginRight: '7px' }}>{item.icon}</span>
                                <strong style={{ color: 'var(--wgs-chat-media-title)' }}>{item.title}</strong><br />
                                <span style={{ color: 'var(--wgs-chat-media-sub)' }}>{item.message}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderChatComposer = () => (
        <>
            {renderChatPicker()}
            <div className="wgs-chat-composer" style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <button
                    type="button"
                    onClick={() => setChatPickerOpen((prev) => !prev)}
                    className="wgs-chat-tool-btn"
                    style={{
                        width: '52px',
                        minWidth: '52px',
                        height: '52px',
                        padding: 0,
                        border: '1px solid var(--wgs-chat-border)',
                        borderRadius: '10px',
                        background: chatPickerOpen ? 'var(--wgs-chat-tool-active-bg)' : 'var(--wgs-chat-control-bg)',
                        color: 'var(--wgs-chat-text-strong)',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        lineHeight: 1
                    }}
                    title="이모지/스티커/GIF 문구 열기"
                >
                    😊
                </button>
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendChatMessage();
                        }
                    }}
                    maxLength={500}
                    placeholder={liveChatInputPlaceholder}
                    className="wgs-chat-input"
                    style={{
                        flex: 1,
                        minWidth: 0,
                        height: '52px',
                        padding: '0 14px',
                        borderRadius: '10px',
                        border: '1px solid var(--wgs-chat-border)',
                        background: 'var(--wgs-chat-control-bg)',
                        color: 'var(--wgs-chat-input-text)',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                    }}
                />
                <button
                    type="button"
                    onClick={() => sendChatMessage()}
                    disabled={isChatLoading}
                    className="wgs-chat-send-btn"
                    style={{
                        minWidth: '64px',
                        height: '52px',
                        padding: '0 16px',
                        border: 'none',
                        borderRadius: '10px',
                        background: isChatLoading ? 'var(--wgs-chat-disabled-bg)' : '#10b981',
                        color: 'white',
                        cursor: isChatLoading ? 'not-allowed' : 'pointer',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1
                    }}
                >{liveChatSendButtonLabel}</button>
            </div>
        </>
    );

    return (
        <section
            className="wgs-chat-panel"
            style={{
                background: 'var(--wgs-realtime-card-bg)',
                border: '1px solid var(--wgs-realtime-card-border)',
                borderRadius: '12px',
                padding: '15px',
                minHeight: '290px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                width: '100%'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <strong className="wgs-chat-title" style={{ color: 'var(--wgs-realtime-heading)', fontSize: '15px' }}>{liveChatChatTitle}</strong>
                <button
                    type="button"
                    onClick={openChatPopupWindow}
                    style={{ padding: '8px 13px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 3px 8px rgba(0,0,0,0.18)' }}
                >{liveChatPopupButtonLabel}</button>
            </div>

            <div className="wgs-chat-meta" style={{ color: 'var(--wgs-realtime-muted)', fontSize: '12px', marginBottom: '10px', lineHeight: 1.5 }}>
                {liveChatAutoLabel} {chatLastRefreshedAt || chatPopupNotRefreshedLabel}<br />
                {liveChatResetNotice}
            </div>

            {renderChatMessageList('190px')}
            {renderChatComposer()}
        </section>
    );
}
