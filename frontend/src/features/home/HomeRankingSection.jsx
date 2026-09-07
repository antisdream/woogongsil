// Home page feature module for HomeRankingSection.
import React from 'react';
import { Link } from 'react-router-dom';
import MyRankingHistoryChart from '../../components/MyRankingHistoryChart.jsx';

export default function HomeRankingSection({
    loggedInUser,
    scoreRankingTitle,
    scoreRankingAlwaysOpenLabel,
    rankingTab,
    setRankingTab,
    rankingRandomTabLabel,
    rankingPastTabLabel,
    rankingIpepRandomTabLabel,
    rankingIpepPastTabLabel,
    isPastRankingTab,
    pastYearOptions,
    pastYear,
    setPastYear,
    pastSessionOptions,
    pastSession,
    setPastSession,
    scoreRankingYearSelectTitle,
    scoreRankingSessionSelectTitle,
    canShowChart,
    scoreRankingNeedSelectMessage,
    scoreRankingTopPrefix,
    rankingLabel,
    scoreRankingTopSuffix,
    seasonText,
    rankingData,
    scoreRankingNoDataMessage,
    scoreRankingRankSuffix,
    scoreRankingScoreSuffix,
    formatAccuracyText,
    scoreRankingMyRankTitle,
    myRankingData,
    scoreRankingNoPersonalMessage,
    getHomeScreenSetting,
}) {
    if (!loggedInUser) return <section className="ui-home-record-invite ui-panel"><div><h2>나의 공부를 한곳에 모으세요.</h2><p>로그인하면 저장한 오답과 학습 기록을 확인할 수 있어요.</p></div><Link to="/login" className="ui-primary">내 기록으로 로그인</Link></section>;
    return (
        <section className="ui-home-ranking" aria-label="학습 순위와 기록" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'var(--wgs-card)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--wgs-border)', display: 'flex', flexDirection: 'column' }}>
                <div
                    style={{ width: '100%', padding: '15px 20px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '18px', fontWeight: 'bold', boxSizing: 'border-box' }}
                >
                    <h2 className="ui-ranking-title">{scoreRankingTitle}</h2>
                    <span className="ui-ranking-mode-label">{scoreRankingAlwaysOpenLabel === '항상 펼침' ? '실제 학습 기록' : scoreRankingAlwaysOpenLabel}</span>
                </div>

                <div style={{ padding: '20px', background: 'var(--wgs-card)' }}>
                    <div
                        className="home-ranking-tabs" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', marginBottom: '20px' }}
                    >
                        <button type="button" aria-pressed={rankingTab === 'random'} onClick={() => setRankingTab('random')} style={{ padding: '12px', background: rankingTab === 'random'? 'var(--wgs-primary)' : 'var(--wgs-card-soft)', color: rankingTab === 'random' ? 'var(--wgs-card)' : 'var(--wgs-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{rankingRandomTabLabel}</button>
                        <button type="button" aria-pressed={rankingTab === 'past'} onClick={() => { setRankingTab('past'); setPastYear(null); setPastSession(null); }} style={{ padding: '12px', background: rankingTab === 'past'? 'var(--wgs-primary)' : 'var(--wgs-card-soft)', color: rankingTab === 'past' ? 'var(--wgs-card)' : 'var(--wgs-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{rankingPastTabLabel}</button>
                        <button type="button" aria-pressed={rankingTab === 'ipep_random'} onClick={() => setRankingTab('ipep_random')} style={{ padding: '12px', background: rankingTab === 'ipep_random'? 'var(--wgs-primary)' : 'var(--wgs-card-soft)', color: rankingTab === 'ipep_random' ? 'var(--wgs-card)' : 'var(--wgs-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{rankingIpepRandomTabLabel}</button>
                        <button type="button" aria-pressed={rankingTab === 'ipep_past'} onClick={() => { setRankingTab('ipep_past'); setPastYear(null); setPastSession(null); }} style={{ padding: '12px', background: rankingTab === 'ipep_past'? 'var(--wgs-primary)' : 'var(--wgs-card-soft)', color: rankingTab === 'ipep_past' ? 'var(--wgs-card)' : 'var(--wgs-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{rankingIpepPastTabLabel}</button>
                    </div>

                    {isPastRankingTab && (
                        <div style={{ background: 'var(--wgs-input-bg)', padding: '15px', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--wgs-border)' }}>
                            <div style={{ marginBottom: '15px' }}>
                                <div style={{ color: 'var(--wgs-title)', fontWeight: 'bold', marginBottom: '8px', fontSize: '15px' }}>{scoreRankingYearSelectTitle}</div>
                                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                    {pastYearOptions.map((year) => (
                                        <label key={year} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--wgs-muted)', fontSize: '15px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={pastYear === year} onChange={() => { setPastYear(pastYear === year ? null : year); setPastSession(null); }} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3b82f6' }} /> {year}년
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: 'var(--wgs-title)', fontWeight: 'bold', marginBottom: '8px', fontSize: '15px' }}>{scoreRankingSessionSelectTitle}</div>
                                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                    {pastSessionOptions.map((session) => (
                                        <label key={session} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--wgs-muted)', fontSize: '15px', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={pastSession === session} onChange={() => setPastSession(pastSession === session ? null : session)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3b82f6' }} /> {session}회차
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {!canShowChart ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--wgs-subtle)', background: 'var(--wgs-input-bg)', borderRadius: '8px' }}>{scoreRankingNeedSelectMessage}</div>
                    ) : (
                        <div style={{ background: 'var(--wgs-input-bg)', padding: '20px', borderRadius: '8px', border: '1px solid var(--wgs-border)' }}>
                            <h3 style={{ margin: '0 0 12px 0', color: 'var(--wgs-title)', textAlign: 'center' }}>
                                {scoreRankingTopPrefix} {rankingLabel} {scoreRankingTopSuffix}<br />[{seasonText}]
                            </h3>

                            {rankingData.length === 0 ? (
                                <div style={{ textAlign: 'center', color: '#64748b', padding: '20px', lineHeight: '1.6' }}>
                                    {scoreRankingNoDataMessage}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    {rankingData.map((data, index) => (
                                        <div key={index} className="ui-ranking-row" style={{ background: 'var(--wgs-card-soft)', padding: '15px', borderRadius: '10px', border: '1px solid var(--wgs-border)', position: 'relative', overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: 'var(--wgs-title)', fontWeight: 'bold', fontSize: '18px' }}>
                                                    {data.rank}{scoreRankingRankSuffix} {data.name}
                                                </span>
                                                <span style={{ color: 'var(--wgs-primary)', fontWeight: 'bold', fontSize: '18px' }}>{data.score}{scoreRankingScoreSuffix}</span>
                                            </div>
                                            <div style={{ background: 'var(--wgs-border)', height: '8px', borderRadius: '4px', margin: '10px 0', overflow: 'hidden' }}>
                                                <div style={{ width: `${data.accuracy}%`, height: '100%', background: 'var(--wgs-primary)', transition: 'width 1s ease-in-out' }} />
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--wgs-subtle)', textAlign: 'right' }}>{formatAccuracyText(data)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '2px dashed var(--wgs-border)' }}>
                                <h4 style={{ color: 'var(--wgs-title)', margin: '0 0 10px 0', fontSize: '16px' }}>{scoreRankingMyRankTitle}</h4>
                                {myRankingData ? (
                                    <div
                                        className="home-my-ranking-row" style={{ background: 'var(--wgs-card-soft)', padding: '15px', borderRadius: '10px', border: '1px solid var(--wgs-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}
                                    >
                                        <span style={{ color: 'var(--wgs-title)', fontWeight: 'bold', fontSize: '16px' }}>
                                            {myRankingData.rank}{scoreRankingRankSuffix} {myRankingData.name}
                                        </span>
                                        <span style={{ color: 'var(--wgs-primary)', fontWeight: 'bold', fontSize: '16px' }}>{myRankingData.score}{scoreRankingScoreSuffix}</span>
                                        <span style={{ color: 'var(--wgs-subtle)', fontSize: '14px' }}>{formatAccuracyText(myRankingData)}</span>
                                    </div>
                                ) : (
                                    <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '15px', borderRadius: '10px', textAlign: 'center', color: 'var(--wgs-subtle)', fontSize: '14px', border: '1px solid var(--wgs-border)' }}>
                                        {scoreRankingNoPersonalMessage}
                                    </div>
                                )}
                            </div>

                            <MyRankingHistoryChart
                                getHomeScreenSetting={getHomeScreenSetting}
                                activeType={rankingTab}
                            />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
