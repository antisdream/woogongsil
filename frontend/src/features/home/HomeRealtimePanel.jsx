// Home page feature module for HomeRealtimePanel.
import React from 'react';

export default function HomeRealtimePanel({
    loggedInUser,
    liveChatSectionTitle,
    liveChatSectionDesc,
    liveChatCurrentVisitorPrefix,
    liveChatCurrentVisitorSuffix,
    onlineUsers,
    liveChatVisitorsTitle,
    isOnlineUsersLoading,
    refreshOnlineUsers,
    liveChatRefreshLoadingLabel,
    liveChatRefreshButtonLabel,
    onlineUsersLastRefreshedAt,
    liveChatRequestTimeLabel,
    liveChatVisitorsRequestEmpty,
    liveChatVisitorsRecentDesc,
    onlineUsersError,
    liveChatVisitorsEmptyBox,
    liveChatMeLabel,
    liveChatRecentActivityLabel,
    formatOnlineTime,
    renderChatPanel,
}) {
    if (!loggedInUser) return null;

    return (
        <div
            className="home-realtime-panel" style={{
                width: '100%',
                background: 'var(--wgs-realtime-panel-bg)',
                borderRadius: '12px',
                border: '1px solid var(--wgs-realtime-panel-border)',
                padding: '22px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                    <h3 className="home-realtime-title" style={{ margin: 0, color: 'var(--wgs-realtime-title)', fontSize: '20px' }}>{liveChatSectionTitle}</h3>
                    <p className="home-realtime-desc" style={{ margin: '7px 0 0 0', color: 'var(--wgs-realtime-muted)', fontSize: '12px', lineHeight: 1.5 }}>
                        {liveChatSectionDesc}
                    </p>
                </div>
                <div className="home-realtime-count" style={{ background: 'var(--wgs-realtime-count-bg)', color: 'var(--wgs-realtime-count-text)', padding: '8px 14px', borderRadius: '999px', fontWeight: 'bold', border: '1px solid var(--wgs-realtime-count-border)', whiteSpace: 'nowrap' }}>
                    {liveChatCurrentVisitorPrefix} {onlineUsers.length}{liveChatCurrentVisitorSuffix}
                </div>
            </div>

            <div className="home-realtime-grid">
                <section
                    className="wgs-online-panel" style={{
                        background: 'var(--wgs-realtime-card-bg)',
                        border: '1px solid var(--wgs-realtime-card-border)',
                        borderRadius: '12px',
                        padding: '15px',
                        minHeight: '290px',
                        boxSizing: 'border-box',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <strong className="wgs-online-title" style={{ color: 'var(--wgs-realtime-heading)', fontSize: '15px' }}>{liveChatVisitorsTitle}</strong>
                        <button
                            type="button" onClick={refreshOnlineUsers}
                            disabled={isOnlineUsersLoading}
                            style={{
                                padding: '8px 13px',
                                background: isOnlineUsersLoading ? '#475569' : '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: isOnlineUsersLoading ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                fontSize: '13px',
                                boxShadow: '0 3px 8px rgba(0,0,0,0.18)'
                            }}
                        >
                            {isOnlineUsersLoading ? liveChatRefreshLoadingLabel : liveChatRefreshButtonLabel}
                        </button>
                    </div>

                    <div className="wgs-online-meta" style={{ color: 'var(--wgs-realtime-muted)', fontSize: '12px', marginBottom: '10px', lineHeight: 1.5 }}>
                        {onlineUsersLastRefreshedAt ? `${liveChatRequestTimeLabel} ${onlineUsersLastRefreshedAt}` : liveChatVisitorsRequestEmpty}<br />
                        {liveChatVisitorsRecentDesc}
                    </div>

                    {onlineUsersError ? (
                        <div className="wgs-online-error" style={{ background: 'rgba(239,68,68,0.10)', color: 'var(--wgs-chat-error)', borderRadius: '10px', padding: '12px', textAlign: 'center', fontSize: '13px', border: '1px dashed rgba(239,68,68,0.45)' }}>
                            {onlineUsersError}
                        </div>
                    ) : onlineUsers.length === 0 ? (
                        <div className="wgs-online-empty" style={{ background: 'var(--wgs-chat-list-bg)', color: 'var(--wgs-realtime-muted)', borderRadius: '10px', padding: '12px', textAlign: 'center', fontSize: '13px', border: '1px dashed var(--wgs-chat-border)' }}>
                            {liveChatVisitorsEmptyBox}
                        </div>
                    ) : (
                        <ul className="wgs-online-user-list" style={{ maxHeight: '190px', overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                            {onlineUsers.map((user) => {
                                const isMe = String(user.id) === String(sessionStorage.getItem('userId'));
                                return (
                                    <li key={user.id} className={isMe ? 'wgs-online-user-row is-me' : 'wgs-online-user-row'}>
                                        <div className="wgs-online-user-main">
                                            <span className="wgs-online-user-icon"></span>
                                            <span className="wgs-online-user-name">{user.name || user.id}</span>
                                            {isMe && <span className="wgs-online-user-me">{liveChatMeLabel}</span>}
                                        </div>
                                        <time className="wgs-online-user-time">
                                            {liveChatRecentActivityLabel} {formatOnlineTime(user.lastSeenAt)}
                                        </time>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {renderChatPanel()}
            </div>
        </div>
    );
}
