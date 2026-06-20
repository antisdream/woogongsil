// 운세 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import useScreenSettings from '../useScreenSettings';

const API_BASE = "";

const TIME_OPTIONS = [
    { key: "unknown", label: "선택 (시간을 모름)", value: "unknown" },
    { key: "ja", label: "자시 (23:30 ~ 01:29)", value: "00:00" }, { key: "chuk", label: "축시 (01:30 ~ 03:29)", value: "02:00" },
    { key: "in", label: "인시 (03:30 ~ 05:29)", value: "04:00" }, { key: "myo", label: "묘시 (05:30 ~ 07:29)", value: "06:00" },
    { key: "jin", label: "진시 (07:30 ~ 09:29)", value: "08:00" }, { key: "sa", label: "사시 (09:30 ~ 11:29)", value: "10:00" },
    { key: "oh", label: "오시 (11:30 ~ 13:29)", value: "12:00" }, { key: "mi", label: "미시 (13:30 ~ 15:29)", value: "14:00" },
    { key: "sin", label: "신시 (15:30 ~ 17:29)", value: "16:00" }, { key: "yu", label: "유시 (17:30 ~ 19:29)", value: "18:00" },
    { key: "sul", label: "술시 (19:30 ~ 21:29)", value: "20:00" }, { key: "hae", label: "해시 (21:30 ~ 23:29)", value: "22:00" }
];

const YEARS = Array.from({ length: 2026 - 1930 + 1 }, (_, i) =>2026 - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const replaceSettingTokens = (text, values = {}) => {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
};

const Fortune = () => {
    const { getSetting } = useScreenSettings('fortune');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = useCallback((key, fallback, values = {}) => (
        replaceSettingTokens(t(key, fallback), values)
    ), [t]);

    const loggedInUser = sessionStorage.getItem('userName') || '';
    const userId = sessionStorage.getItem('userId');
    const getSessionAuth = useCallback(() => ({
        id: sessionStorage.getItem('userId') || userId || '',
        userId: sessionStorage.getItem('userId') || userId || '',
        sessionToken: sessionStorage.getItem('sessionToken') || '',
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    }), [userId]);
    const loginRedirectedRef = useRef(false);
    const timeOptions = useMemo(() => TIME_OPTIONS.map((option) => ({
        ...option,
        label: t(`time_options.${option.key}`, option.label)
    })), [t]);
    const couplePersonBlocks = useMemo(() => [
        { id: 'p1', label: t('couple.my_info_label', '나의 정보'), color: '#3b82f6' },
        { id: 'p2', label: t('couple.partner_info_label', '상대방 정보'), color: '#ef4444' }
    ], [t]);
    
    const [activeTab, setActiveTab] = useState('individual');
    const [step, setStep] = useState(1); 
    const [result, setResult] = useState(null);

    const [indiv, setIndiv] = useState({ name: loggedInUser, bYear: '연도', bMonth: '월', bDay: '일', birthtime: 'unknown', gender: 'male' });
    const [couple, setCouple] = useState({
        p1: { name: loggedInUser, bYear: '연도', bMonth: '월', bDay: '일', birthtime: 'unknown', gender: 'male' },
        p2: { name: '', bYear: '연도', bMonth: '월', bDay: '일', birthtime: 'unknown', gender: 'female' }
    });

    useEffect(() => {
        if (loginRedirectedRef.current) return;
        if (!sessionStorage.getItem('userName')) {
            loginRedirectedRef.current = true;
            alert(t('messages.login_required', '로그인 후 이용하실 수 있습니다.'));
            window.location.href = '/';
        }
    }, [t]);

    const formatDate = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const saveFortuneHistory = async (type, searchData) => {
        if (!userId) return;
        try {
            await axios.post(`${API_BASE}/api/user/fortune-history`, { ...getSessionAuth(), id: userId, type: type, searchData: searchData });
        } catch (err) { console.error("운세 기록 저장 실패:", err); }
    };

    // 이름 검증 로직 (완성된 한글만 허용. 자음, 모음, 영어, 특수문자, 숫자 불가)
    const validateName = (name) => {
        const nameRegex = /^[가-힣]+$/;
        return nameRegex.test(name);
    };

    const handleIndivSubmit = async (e) => {
        e.preventDefault();
        // 이름 검증 적용
        if (!validateName(indiv.name)) return alert(t('messages.invalid_name', '이름이 정확하지 않습니다, 올바른 이름을 입력해주세요!'));
        if (indiv.bYear === '연도' || indiv.bMonth === '월' || indiv.bDay === '일') return alert(t('messages.need_birthdate', '생년월일을 모두 선택해주세요!'));
        
        const payload = { ...indiv, birthdate: formatDate(indiv.bYear, indiv.bMonth, indiv.bDay) };
        setStep(2); 
        try {
            const res = await axios.post(`${API_BASE}/api/fortune/individual`, payload);
            if (res.data.success) { 
                setResult(res.data.data); 
                setStep(3); 
                saveFortuneHistory('individual', payload);
            }
        } catch (err) { alert(t('messages.server_error', '서버 에러')); setStep(1); }
    };

    const handleCoupleSubmit = async (e) => {
        e.preventDefault();
        if (!validateName(couple.p1.name) || !validateName(couple.p2.name)) {
            return alert(t('messages.invalid_name', '이름이 정확하지 않습니다, 올바른 이름을 입력해주세요!'));
        }
        if (couple.p1.bYear === '연도' || couple.p1.bMonth === '월' || couple.p1.bDay === '일' ||
            couple.p2.bYear === '연도' || couple.p2.bMonth === '월' || couple.p2.bDay === '일') {
            return alert(t('messages.need_birthdate', '생년월일을 모두 선택해주세요!'));
        }

        // 핵심 수정: 자기 자신을 상대방으로 똑같이 넣는 꼼수 차단
        if (couple.p1.name === couple.p2.name && 
            couple.p1.bYear === couple.p2.bYear && 
            couple.p1.bMonth === couple.p2.bMonth && 
            couple.p1.bDay === couple.p2.bDay) {
            return alert(t('messages.invalid_partner', '올바른 상대방 정보를 입력 및 선택해주세요.'));
        }
        
        const payload = {
            p1: { ...couple.p1, birthdate: formatDate(couple.p1.bYear, couple.p1.bMonth, couple.p1.bDay) },
            p2: { ...couple.p2, birthdate: formatDate(couple.p2.bYear, couple.p2.bMonth, couple.p2.bDay) }
        };
        setStep(2); 
        try {
            const res = await axios.post(`${API_BASE}/api/fortune/couple`, payload);
            if (res.data.success) { 
                setResult(res.data.data); 
                setStep(3); 
                saveFortuneHistory('couple', payload);
            }
        } catch (err) { alert(t('messages.server_error', '서버 에러')); setStep(1); }
    };

    const getElementColor = (el) => {
        if(el.includes('목')) return '#10b981'; if(el.includes('화')) return '#ef4444'; 
        if(el.includes('토')) return '#f59e0b'; if(el.includes('금')) return '#f8fafc'; 
        if(el.includes('수')) return '#3b82f6'; return 'var(--wgs-subtle)';
    };

    const renderSajuBox = (sajuObj, title) => (
        <div style={{ flex: 1, background: 'var(--wgs-practice-toggle-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--wgs-border)' }}>
            <h4 style={{ textAlign: 'center', color: 'var(--wgs-title)', marginTop: 0 }}>{formatSetting('result.saju_box_title', '{name} 사주', { name: title })}</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '5px' }}>
                {[
                    [t('result.hour_pillar', '시'), sajuObj.hour],
                    [t('result.day_pillar', '일'), sajuObj.day],
                    [t('result.month_pillar', '월'), sajuObj.month],
                    [t('result.year_pillar', '년'), sajuObj.year]
                ].map(([label, pillar], idx) => (
                    <div key={idx} style={{ flex: 1, background: 'var(--wgs-input-bg)', borderRadius: '6px', padding: '10px 0', textAlign: 'center' }}>
                        <div style={{ color: 'var(--wgs-subtle)', fontSize: '11px', marginBottom: '5px' }}>{label}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>
                            <div>{pillar.substring(0, 4)}</div><div>{pillar.substring(4)}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const DateSelector = ({ data, setter }) => (
        <div style={{ display: 'flex', gap: '5px' }}>
            <select value={data.bYear} onChange={(e) => setter({...data, bYear: e.target.value})} style={{ flex: 1.5, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}>
                <option value="연도">{t('date.year_placeholder', '연도')}</option>{YEARS.map(y => <option key={y} value={y}>{formatSetting('date.year_option', '{value}년', { value: y })}</option>)}
            </select>
            <select value={data.bMonth} onChange={(e) => setter({...data, bMonth: e.target.value})} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}>
                <option value="월">{t('date.month_placeholder', '월')}</option>{MONTHS.map(m => <option key={m} value={m}>{formatSetting('date.month_option', '{value}월', { value: m })}</option>)}
            </select>
            <select value={data.bDay} onChange={(e) => setter({...data, bDay: e.target.value})} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}>
                <option value="일">{t('date.day_placeholder', '일')}</option>{DAYS.map(d => <option key={d} value={d}>{formatSetting('date.day_option', '{value}일', { value: d })}</option>)}
            </select>
        </div>
    );

    return (
        <div className="fortune-page wgs-typography-scope" style={{ maxWidth: '800px', margin: '30px auto', color: 'white', fontFamily: 'var(--wgs-font-body)' }}>
            {step === 1 && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button onClick={() => setActiveTab('individual')} style={{ flex: 1, padding: '15px', background: activeTab === 'individual'? '#3b82f6' : 'var(--wgs-button-muted)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>{t('tabs.individual_label', ' 오늘의 운세?')}</button>
                    <button onClick={() => setActiveTab('couple')} style={{ flex: 1, padding: '15px', background: activeTab === 'couple'? '#ec4899' : 'var(--wgs-button-muted)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>{t('tabs.couple_label', ' 오늘의 궁합?')}</button>
                </div>
            )}

            {step === 1 && activeTab === 'individual' && (
                <div style={{ background: 'var(--wgs-button-muted)', padding: '40px', borderRadius: '12px' }}>
                    <h2 style={{ color: '#fcd34d', textAlign: 'center', marginTop: 0 }}>{t('individual.title', ' 오늘의 운세 정보 입력')}</h2>
                    <form onSubmit={handleIndivSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 200px' }}><label style={{ color: 'var(--wgs-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('form.name_label', '이름')}</label><input type="text" placeholder={t('form.name_placeholder', '이름 입력')} value={indiv.name} onChange={(e) => setIndiv({...indiv, name: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} /></div>
                            <div style={{ flex: '1 1 150px' }}><label style={{ color: 'var(--wgs-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('form.gender_label', '성별')}</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button type="button" onClick={() => setIndiv({...indiv, gender: 'male'})} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: `2px solid ${indiv.gender === 'male'? '#3b82f6' : 'var(--wgs-border)'}`, background: indiv.gender === 'male'? 'rgba(59, 130, 246, 0.2)' : 'var(--wgs-input-bg)', color: 'white' }}>{t('form.male_short_label', '남')}</button>
                                    <button type="button" onClick={() => setIndiv({...indiv, gender: 'female'})} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: `2px solid ${indiv.gender === 'female'? '#ef4444' : 'var(--wgs-border)'}`, background: indiv.gender === 'female'? 'rgba(239, 68, 68, 0.2)' : 'var(--wgs-input-bg)', color: 'white' }}>{t('form.female_short_label', '여')}</button>
                                </div>
                            </div>
                        </div>
                        <div><label style={{ color: 'var(--wgs-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('form.birthdate_label', '생년월일 (양력)')}</label><DateSelector data={indiv} setter={setIndiv} /></div>
                        <div><label style={{ color: 'var(--wgs-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('form.birthtime_optional_label', '태어난 시간 (선택)')}</label>
                            <select value={indiv.birthtime} onChange={(e) => setIndiv({...indiv, birthtime: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}>
                                {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        </div>
                        <button type="submit" style={{ padding: '18px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>{t('individual.submit_button', '결과 확인하기')}</button>
                    </form>
                </div>
            )}

            {step === 1 && activeTab === 'couple' && (
                <div style={{ background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px' }}>
                    <h2 style={{ color: '#f9a8d4', textAlign: 'center', marginTop: 0 }}>{t('couple.title', ' 오늘의 궁합 정보 입력')}</h2>
                    <form onSubmit={handleCoupleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginTop: '20px' }}>
                        {couplePersonBlocks.map(person => (
                            <div key={person.id} style={{ padding: '20px', background: 'var(--wgs-practice-toggle-bg)', borderRadius: '10px', borderLeft: `4px solid ${person.color}` }}>
                                <h3 style={{ margin: '0 0 15px 0', color: person.color }}>{person.label}</h3>
                                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '15px' }}>
                                    <div style={{ flex: '2 1 150px' }}><label style={{ color: 'var(--wgs-subtle)', fontSize: '13px', display: 'block', marginBottom: '5px' }}>{t('form.name_label', '이름')}</label><input type="text" placeholder={t('form.name_placeholder', '이름 입력')} value={couple[person.id].name} onChange={e => setCouple({...couple, [person.id]: {...couple[person.id], name: e.target.value}})} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }} /></div>
                                    <div style={{ flex: '1 1 100px' }}><label style={{ color: 'var(--wgs-subtle)', fontSize: '13px', display: 'block', marginBottom: '5px' }}>{t('form.gender_label', '성별')}</label><select value={couple[person.id].gender} onChange={e => setCouple({...couple, [person.id]: {...couple[person.id], gender: e.target.value}})} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}><option value="male">{t('form.male_label', '남성')}</option><option value="female">{t('form.female_label', '여성')}</option></select></div>
                                </div>
                                <div style={{ marginBottom: '15px' }}><label style={{ color: 'var(--wgs-subtle)', fontSize: '13px', display: 'block', marginBottom: '5px' }}>{t('form.birthdate_label', '생년월일 (양력)')}</label><DateSelector data={couple[person.id]} setter={(newData) => setCouple({...couple, [person.id]: newData})} /></div>
                                <div><label style={{ color: 'var(--wgs-subtle)', fontSize: '13px', display: 'block', marginBottom: '5px' }}>{t('form.birthtime_label', '태어난 시간')}</label><select value={couple[person.id].birthtime} onChange={e => setCouple({...couple, [person.id]: {...couple[person.id], birthtime: e.target.value}})} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid var(--wgs-border)', background: 'var(--wgs-input-bg)', color: 'white' }}>{timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                            </div>
                        ))}
                        <button type="submit" style={{ padding: '18px', background: '#ec4899', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>{t('couple.submit_button', '궁합 확인하기')}</button>
                    </form>
                </div>
            )}

            {step === 2 && (
                <div style={{ background: 'var(--wgs-button-muted)', padding: '60px 20px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '60px', animation: 'spin 2s linear infinite', display: 'inline-block' }}></div>
                    <h2 style={{ color: activeTab === 'couple'? '#f9a8d4' : '#fcd34d', marginTop: '20px' }}>{t('loading.text', '만세력을 세우는 중입니다...')}</h2>
                    <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {step === 3 && activeTab === 'individual' && result && (
                <div style={{ animation: 'fadeIn 0.8s' }}>
                    <div style={{ background: 'var(--wgs-practice-toggle-bg)', padding: '30px', borderRadius: '12px', marginBottom: '20px' }}>
                        <h2 style={{ textAlign: 'center', color: '#fcd34d', marginTop: 0 }}>{formatSetting('result.individual_saju_title', ' {name}님의 사주 명식', { name: result.name })}</h2>
                        {renderSajuBox(result.saju, result.name)}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', padding: '15px', background: 'var(--wgs-input-bg)', borderRadius: '8px' }}>
                            <div>{t('result.gyeokguk_label', '격국: ')}<strong style={{ color: '#fcd34d' }}>{result.gyeokguk}</strong></div>
                            <div>{t('result.yongsin_label', '용신: ')}<strong style={{ color: getElementColor(result.yongsin) }}>{result.yongsin}</strong></div>
                        </div>
                    </div>
                    <div style={{ background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', borderLeft: '5px solid #10b981', marginBottom: '15px' }}>
                        <h3 style={{ color: '#34d399', marginTop: 0 }}>{formatSetting('result.exam_luck_title', ' 학업운 (오늘의 신살: {sinsal})', { sinsal: result.todaySinsal })}</h3>
                        <p style={{ margin: 0 }}>{result.examLuck}</p>
                    </div>
                    <div style={{ background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px' }}>
                        <h3 style={{ color: '#f472b6', marginTop: 0 }}>{t('result.total_luck_title', ' 종합 조언')}</h3>
                        <p style={{ margin: 0, color: 'var(--wgs-muted)' }}>{result.totalLuck}</p>
                    </div>
                    <button onClick={() => setStep(1)} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '20px', fontWeight: 'bold' }}>{t('result.retry_individual_button', '다시 하기')}</button>
                </div>
            )}

            {step === 3 && activeTab === 'couple' && result && (
                <div style={{ animation: 'fadeIn 0.8s' }}>
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                        <h2 style={{ color: '#f9a8d4', margin: 0 }}>{formatSetting('result.couple_score_title', ' {name1} & {name2} 궁합 지수', { name1: result.p1.name, name2: result.p2.name })}</h2>
                        <div style={{ fontSize: '50px', fontWeight: 'bold', color: result.score >= 80 ? '#10b981' : '#f59e0b', marginTop: '10px' }}>{formatSetting('result.score_value', '{score}점', { score: result.score })}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '20px' }}>
                        {renderSajuBox(result.p1.saju, result.p1.name)}
                        {renderSajuBox(result.p2.saju, result.p2.name)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {[
                            { title: t('result.couple_out_title', '1. 겉궁합 (띠와 연주)'), text: result.details.out, color: 'var(--wgs-blue)' },
                            { title: t('result.couple_in_title', '2. 속궁합 (일간과 일지)'), text: result.details.in, color: '#c084fc' },
                            { title: t('result.couple_balance_title', '3. 조후와 억부 (오행 밸런스)'), text: result.details.balance, color: '#f472b6' },
                            { title: t('result.couple_flow_title', '4. 운의 흐름 (대운 일치)'), text: result.details.flow, color: '#fbbf24' }
                        ].map((item, i) => (
                            <div key={i} style={{ background: 'var(--wgs-button-muted)', padding: '20px', borderRadius: '12px', borderLeft: `5px solid ${item.color}` }}>
                                <h3 style={{ color: item.color, margin: '0 0 10px 0', fontSize: '18px' }}>{item.title}</h3>
                                <p style={{ margin: 0, lineHeight: '1.6', fontSize: '15px', color: '#e2e8f0' }}>{item.text}</p>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setStep(1)} style={{ width: '100%', padding: '15px', background: '#ec4899', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '20px', fontWeight: 'bold' }}>{t('result.retry_couple_button', '다른 궁합 보기')}</button>
                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                </div>
            )}
        </div>
    );
};

export default Fortune;
