import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FiBookOpen, FiHome, FiRotateCcw, FiUser, FiMenu, FiX, FiSliders } from 'react-icons/fi';
import ThemeModeToggle from './ThemeModeToggle';

export default function AppNavigation({ siteTitle, labels, loggedInUser, onNavigate, onLogout, themeMode, themeTone, onChangeTheme, onChangeThemeTone }) {
    const { pathname } = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const menuButton = useRef(null);
    const settings = useRef(null);
    const settingsButton = useRef(null);
    const brandTitle = !siteTitle || siteTitle === 'SKN_우공실' ? '우공실' : siteTitle;
    useEffect(() => {
        const dismiss = (event) => {
            if (event.key !== 'Escape') return;
            if (menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
            if (settingsOpen) { setSettingsOpen(false); settingsButton.current?.focus(); }
        };
        const outside = (event) => { if (settingsOpen && !settings.current?.contains(event.target)) setSettingsOpen(false); };
        document.addEventListener('keydown', dismiss);
        document.addEventListener('pointerdown', outside);
        return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside); };
    }, [menuOpen, settingsOpen]);
    const links = [
        { path: '/', label: labels.home, Icon: FiHome },
        { path: '/cert/ipe', label: '학습', Icon: FiBookOpen, match: ['/cert/ipe', '/written', '/practice', '/exam', '/ipep'] },
        { path: '/wrong', label: '오답 복습', Icon: FiRotateCcw },
        ...(loggedInUser ? [{ path: '/study', label: labels.study }] : []),
        { path: '/multiplayer', label: labels.multiplayer },
        { path: '/board', label: labels.board },
    ];
    const active = ({ path, match }) => path === '/' ? pathname === '/' : (match || [path]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
    const go = (event, path) => { onNavigate(event, path); setMenuOpen(false); setSettingsOpen(false); };
    const renderLink = (link, compact = false) => <a key={link.path} href={link.path} onClick={(event) => go(event, link.path)} className={`ui-nav-link ${active(link) ? 'is-current' : ''}`} aria-current={active(link) ? 'page' : undefined}>{compact && link.Icon && <link.Icon aria-hidden="true" />}<span>{link.label}</span></a>;
    const account = { path: loggedInUser ? '/mypage' : '/login', label: loggedInUser ? '내 기록' : labels.login, Icon: FiUser };
    return <>
        <div className="ui-header-row">
            <a className="ui-brand" href="/" onClick={(event) => go(event, '/')} aria-label={`${siteTitle} 홈`}><span className="ui-brand-mark"><FiBookOpen aria-hidden="true" /></span><span>{brandTitle}<small>매일 한 걸음, 나의 공부실</small></span></a>
            <nav className="ui-desktop-nav" aria-label="주요 메뉴">{links.map((link) => renderLink(link))}</nav>
            <div className="ui-header-actions">
                <div className="ui-settings" ref={settings}>
                    <button ref={settingsButton} className="ui-icon-button" type="button" aria-label="화면 설정" aria-expanded={settingsOpen} aria-controls="ui-screen-settings" onClick={() => setSettingsOpen((open) => !open)}><FiSliders aria-hidden="true" /></button>
                    {settingsOpen && <section id="ui-screen-settings" className="ui-settings-panel" aria-label="화면 설정"><strong>편안한 화면으로</strong><ThemeModeToggle themeMode={themeMode} themeTone={themeTone} onChangeTheme={onChangeTheme} onChangeThemeTone={onChangeThemeTone} /></section>}
                </div>
                <a className="ui-account-link" href={account.path} onClick={(event) => go(event, account.path)}><FiUser aria-hidden="true" />{account.label}</a>
                <button ref={menuButton} className="ui-menu-button ui-icon-button" type="button" aria-label={menuOpen ? '전체 메뉴 닫기' : '전체 메뉴 열기'} aria-expanded={menuOpen} aria-controls="ui-all-menu" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <FiX aria-hidden="true" /> : <FiMenu aria-hidden="true" />}</button>
            </div>
        </div>
        <nav id="ui-all-menu" className="ui-all-menu" aria-label="전체 메뉴" hidden={!menuOpen}>
            <div className="ui-menu-main">{links.map((link) => renderLink(link))}</div>
            <div className="ui-menu-extra">{renderLink({ path: '/faq', label: labels.faq })}{renderLink({ path: '/fortune', label: labels.fortune })}{renderLink(account)}{loggedInUser ? <button className="ui-nav-link" type="button" onClick={() => { setMenuOpen(false); onLogout(false); }}>{labels.logout}</button> : renderLink({ path: '/signup', label: '회원가입' })}</div>
        </nav>
        <nav className="ui-mobile-nav" aria-label="빠른 이동">{[links[0], links[1], { path: '/wrong', label: '오답', Icon: FiRotateCcw }, { ...account, label: loggedInUser ? '기록' : '로그인' }].map((link) => renderLink(link, true))}</nav>
    </>;
}
