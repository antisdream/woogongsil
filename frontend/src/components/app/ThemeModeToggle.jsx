function ThemeModeToggle({ themeMode, onChangeTheme }) {
    const isDark = themeMode === 'dark';

    return (
        <div className="theme-switch-wrap">
            <div className="wgs-theme-toggle" role="group" aria-label="화면 테마 선택">
                <span
                    className="wgs-theme-toggle-thumb"
                    style={{ transform: isDark ? 'translateX(0)' : 'translateX(100%)' }}
                    aria-hidden="true"
                />
                <button
                    type="button"
                    className={isDark ? 'is-active' : ''}
                    onClick={() => onChangeTheme('dark')}
                    aria-pressed={isDark}
                >
                    다크
                </button>
                <button
                    type="button"
                    className={!isDark ? 'is-active' : ''}
                    onClick={() => onChangeTheme('light')}
                    aria-pressed={!isDark}
                >
                    라이트
                </button>
            </div>
        </div>
    );
}

export default ThemeModeToggle;
