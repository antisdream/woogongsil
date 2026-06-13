// Home page feature module for RealCalendar.
import React, { useState } from 'react';
import {
  getCalendarDateNumberClass,
  getCalendarDateNumberStyle,
  getKstTodayString,
  isCalendarRedDate,
} from './calendarUtils.js';

const RealCalendar = ({ classSchedules = [], calendarCopy = {} }) => {
    const [currentDate, setCurrentDate] = useState(new Date()); 
    const getCalendarCopy = (key, fallback) => {
        const value = calendarCopy?.[key];
        return value === undefined || value === null || value === ''? fallback : value;
    }; 
    const goToToday = () => setCurrentDate(new Date());
    const changeMonth = (offset) => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
    
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const todayStr = getKstTodayString();

    const days = [];
    for (let i = 0; i < firstDay; i++) {
        days.push(<div key={`empty-${currentDate.getFullYear()}-${currentDate.getMonth()}-${i}`} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayEvents = classSchedules.filter(s => s.date === dateStr);
        const holidayEvents = dayEvents.filter((event) => event.isHoliday);
        const classEvents = dayEvents.filter((event) => !event.isHoliday);
        const hasHoliday = holidayEvents.length >0;
        const isToday = dateStr === todayStr;
        const isRedDate = isCalendarRedDate(dateStr, hasHoliday);

        days.push(
            <div key={`day-${dateStr}`} className={isToday ? 'wgs-kst-today-cell' : ''} data-calendar-day={dateStr} style={{ 
                border: isToday ? '2px solid #10b981' : '1px solid var(--wgs-border)', 
                minHeight: '85px', padding: '5px', 
                background: isToday ? 'rgba(16, 185, 129, 0.1)' : 'var(--wgs-input-bg)', 
                borderRadius: '4px', overflow: 'hidden'
            }}>
                {/* 날짜 숫자는 DB 이벤트 색상과 완전히 분리합니다. 주말(토/일)·공휴일만 빨강, 그 외 평일은 기본색입니다. */}
                <div
                    key={`date-number-${dateStr}-${isRedDate ? 'red' : 'normal'}`}
                    className={getCalendarDateNumberClass()}
                    data-calendar-date={dateStr}
                    data-calendar-red-day={isRedDate ? 'true' : 'false'}
                    style={getCalendarDateNumberStyle(dateStr, hasHoliday)}
                >
                    {d}
                </div>

                {holidayEvents.map((evt, idx) => (
                    <div key={`holiday-${idx}`} style={{
                        color: '#ef4444',
                        fontSize: '10px',
                        marginBottom: '2px',
                        fontWeight: 700,
                        lineHeight: '1.25'
                    }}>
                        {evt.displayLabel || evt.title}
                    </div>
                ))}
                
                {classEvents.map((evt, idx) => (
                    <div key={`class-${idx}`} style={{ 
                        background: evt.colorSet.bg, 
                        color: evt.isUnitProject ? '#fde047' : evt.colorSet.text, 
                        fontWeight: evt.isUnitProject ? '800' : '500', 
                        border: evt.isUnitProject ? '1px solid #fde047' : (evt.colorSet.border && evt.colorSet.border !== 'transparent'? `1px solid ${evt.colorSet.border}` : 'none'),
                        boxShadow: evt.highlightType === 'glow'? `0 0 10px ${evt.colorSet.border || evt.colorSet.bg}` : 'none',
                        fontSize: '11px', padding: '3px 4px', borderRadius: '4px', marginTop: '2px', textAlign: 'left', lineHeight: '1.3' 
                    }}>
                        {evt.displayLabel || (evt.dayNum ? `${evt.dayNum}일차 - ${evt.title}` : evt.title)}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="home-calendar-card" style={{ background: 'var(--wgs-button-muted)', padding: '15px', borderRadius: '12px' }}>
            <style>{`
                @keyframes glow {
                    from { box-shadow: 0 0 5px rgba(251, 191, 36, 0.2); }
                    to { box-shadow: 0 0 15px rgba(251, 191, 36, 0.8); }
                }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <button onClick={() => changeMonth(-1)} style={{ padding: '8px 12px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>이전</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={{ margin: 0, color: 'white', fontSize: '16px' }}>{currentDate.getFullYear()}{getCalendarCopy('yearSuffix', '년')} {currentDate.getMonth() + 1}{getCalendarCopy('monthSuffix', '월')}</h3>
                    <button onClick={goToToday} style={{ padding: '4px 10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>{getCalendarCopy('todayLabel', 'Today')}</button>
                </div>
                <button onClick={() => changeMonth(1)} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>다음</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: '450px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontWeight: 'bold', marginBottom: '10px', color: 'var(--wgs-subtle)', fontSize: '12px' }}>
                        <div style={{ color: '#ef4444' }}>{getCalendarCopy('weekdaySun', '일')}</div><div>{getCalendarCopy('weekdayMon', '월')}</div><div>{getCalendarCopy('weekdayTue', '화')}</div><div>{getCalendarCopy('weekdayWed', '수')}</div><div>{getCalendarCopy('weekdayThu', '목')}</div><div>{getCalendarCopy('weekdayFri', '금')}</div><div style={{ color: '#3b82f6' }}>{getCalendarCopy('weekdaySat', '토')}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>{days}</div>
                </div>
            </div>
        </div>
    );
};

export default RealCalendar;
