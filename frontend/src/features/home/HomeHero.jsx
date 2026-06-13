// Home page feature module for HomeHero.
import React from 'react';

export default function HomeHero({
    homeDefaultBanner,
    homeHeroTitle,
    homeHeroDesc,
    loggedInUser,
    dDay,
    todayClass,
    calcDday,
    homeWelcomePrefix,
    homeWelcomeSuffix,
    homeDdayPrefix,
    homeDdaySuffix,
    homeTodayClassPrefix,
    homeTodayClassSuffix,
    homeExamButtonUrl,
    homeExamButtonLabel,
    homeNotionButtonUrl,
    homeNotionButtonLabel,
    homeDeveloperButtonUrl,
    homeDeveloperButtonLabel,
    homeMobileButtonLabel,
    onShowQr,
}) {
    return (
        <div
            className="home-hero wgs-landing-hero" style={{
                background: homeDefaultBanner
                    ? `linear-gradient(135deg, rgba(8, 21, 43, 0.72), rgba(6, 78, 59, 0.58)), url(${homeDefaultBanner}) center/cover no-repeat`
                    : 'linear-gradient(135deg, var(--wgs-practice-toggle-bg), var(--wgs-card))',
                padding: 'clamp(28px, 4vw, 54px) clamp(22px, 4vw, 46px)',
                borderRadius: '15px',
                textAlign: 'center',
                marginBottom: '30px',
                boxSizing: 'border-box',
                minHeight: 'clamp(430px, 38vw, 560px)',
                display: 'grid',
                gridTemplateRows: 'auto 1fr auto',
                alignItems: 'stretch',
                overflow: 'hidden'
            }}
        >
            <div
                className="home-hero-title-zone" style={{
                    alignSelf: 'start',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-start'
                }}
            >
                <h1
                    className="wgs-page-title" style={{
                        fontSize: 'clamp(38px, 5vw, 76px)',
                        color: 'var(--wgs-title)',
                        margin: 0,
                        lineHeight: 1.08,
                        letterSpacing: '-0.04em',
                        textShadow: '0 3px 12px rgba(255,255,255,0.25)'
                    }}
                >
                    {homeHeroTitle}
                </h1>
            </div>

            <p
                className="wgs-home-hero-desc" style={{
                    color: 'var(--wgs-muted)',
                    fontSize: 'clamp(16px, 1.6vw, 22px)',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    margin: '16px auto 0',
                    maxWidth: '780px',
                    wordBreak: 'keep-all',
                    textShadow: '0 3px 14px rgba(255,255,255,0.35)'
                }}
            >
                {homeHeroDesc}
            </p>

            <div
                className="home-hero-message-zone" style={{
                    alignSelf: 'center',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: loggedInUser ? '150px' : '80px',
                    pointerEvents: 'none'
                }}
            >
                {loggedInUser && (
                    <div
                        className="wgs-home-welcome-card" style={{
                            maxWidth: '720px',
                            margin: '0 auto',
                            padding: '10px 18px',
                            borderRadius: '14px',
                            background: 'transparent',
                            border: 'none',
                            boxShadow: 'none',
                            pointerEvents: 'auto'
                        }}
                    >
                        <h2
                            className="wgs-section-title" style={{
                                color: 'var(--wgs-title)',
                                fontSize: 'clamp(24px, 3vw, 40px)',
                                margin: '0 0 10px 0',
                                lineHeight: 1.25,
                                letterSpacing: '-0.04em',
                                textShadow: '0 3px 14px rgba(255,255,255,0.52)'
                            }}
                        >
                            {homeWelcomePrefix} {loggedInUser}{homeWelcomeSuffix}
                        </h2>
                        {dDay && (
                            <div
                                style={{
                                    color: '#ef4444',
                                    fontSize: 'clamp(15px, 1.5vw, 20px)',
                                    fontWeight: 'bold',
                                    marginBottom: '8px',
                                    textShadow: '0 2px 10px rgba(255,255,255,0.55)'
                                }}
                            >
                                {homeDdayPrefix} {calcDday()}{homeDdaySuffix}
                            </div>
                        )}
                        {todayClass && (
                            <div
                                style={{
                                    color: '#f59e0b',
                                    fontSize: 'clamp(13px, 1.3vw, 17px)',
                                    fontWeight: 700,
                                    letterSpacing: '-0.5px',
                                    lineHeight: 1.5,
                                    wordBreak: 'keep-all',
                                    textShadow: '0 2px 10px rgba(255,255,255,0.55)'
                                }}
                            >
                                {homeTodayClassPrefix} {todayClass.title} {homeTodayClassSuffix}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div
                className="home-hero-link-zone" style={{
                    alignSelf: 'end',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-end'
                }}
            >
                <div
                    className="home-quick-links" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        justifyContent: 'center',
                        gap: '15px',
                        width: 'min(760px, 100%)',
                        margin: '0 auto'
                    }}
                >
                    <a href={homeExamButtonUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '12px 20px', background: '#3b82f6', color: 'white', textDecoration: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '15px', boxShadow: '0 8px 18px rgba(0,0,0,0.16)', whiteSpace: 'nowrap' }}>
                        {homeExamButtonLabel}
                    </a>
                    <a href={homeNotionButtonUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '12px 20px', background: '#10b981', color: 'white', textDecoration: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '15px', boxShadow: '0 8px 18px rgba(0,0,0,0.16)', whiteSpace: 'nowrap' }}>
                        {homeNotionButtonLabel}
                    </a>
                    <a href={homeDeveloperButtonUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '12px 20px', background: '#f59e0b', color: 'white', textDecoration: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '15px', boxShadow: '0 8px 18px rgba(0,0,0,0.16)', whiteSpace: 'nowrap' }}>
                        {homeDeveloperButtonLabel}
                    </a>
                    <button onClick={onShowQr} style={{ padding: '12px 20px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '15px', boxShadow: '0 8px 18px rgba(0,0,0,0.16)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {homeMobileButtonLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
