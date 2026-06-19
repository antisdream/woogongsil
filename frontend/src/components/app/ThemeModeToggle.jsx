function ThemeModeToggle({ themeMode, themeTone, onChangeTheme, onChangeThemeTone }) {
    const isDark = themeMode === 'dark';
    const toneLabel = `${themeTone}%`;

    return (
        <div className="theme-switch-wrap">
            <div className="wgs-theme-toggle" role="group" aria-label="화면 테마 선택">
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
            <label className="wgs-theme-tone-control" aria-label="테마 밝기 조절">
                <span className="wgs-theme-tone-label">밝기</span>
                <input
                    className="wgs-theme-tone-slider"
                    type="range"
                    min="10"
                    max="100"
                    step="10"
                    value={themeTone}
                    onChange={(event) => onChangeThemeTone(event.target.value)}
                />
                <span className="wgs-theme-tone-value">{toneLabel}</span>
            </label>
        </div>
    );
}

export default ThemeModeToggle;
