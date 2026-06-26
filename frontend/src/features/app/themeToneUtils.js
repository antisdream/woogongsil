const THEME_TONE_MIN = 10;
const THEME_TONE_MAX = 100;
const THEME_TONE_STEP = 10;
const THEME_TONE_DEFAULT = 50;
const THEME_TONE_STORAGE_KEYS = {
    light: 'wgsSessionThemeToneLight',
    dark: 'wgsSessionThemeToneDark',
};

// 밝기 조절은 전체 filter 대신 주요 배경/UI 토큰만 다시 계산합니다.
const THEME_TONE_BASE_TOKENS = {
    light: {
        '--wgs-page-bg': '#f7fbff',
        '--wgs-panel': '#ffffff',
        '--wgs-card': '#ffffff',
        '--wgs-card-soft': '#f8fafc',
        '--wgs-surface': '#ffffff',
        '--wgs-surface-2': '#f3f7ff',
        '--wgs-deep-bg': '#eaf3ff',
        '--wgs-neutral-bg': '#f8fafc',
        '--wgs-panel-soft': '#f0f7ff',
        '--wgs-panel-strong': '#ffffff',
        '--wgs-button-muted': '#ebf4ff',
        '--wgs-input-bg': '#ffffff',
        '--wgs-choice-bg': '#ffffff',
        '--wgs-question-bg': '#ffffff',
        '--wgs-exam-card': '#ffffff',
    },
    dark: {
        '--wgs-page-bg': '#061321',
        '--wgs-panel': '#0f1e31',
        '--wgs-card': '#0d1b2d',
        '--wgs-card-soft': '#122338',
        '--wgs-surface': '#0e1d31',
        '--wgs-surface-2': '#12243a',
        '--wgs-deep-bg': '#020817',
        '--wgs-neutral-bg': '#0b1727',
        '--wgs-panel-soft': '#0f1e31',
        '--wgs-panel-strong': '#0d1b2d',
        '--wgs-button-muted': '#111f33',
        '--wgs-input-bg': '#020a17',
        '--wgs-choice-bg': '#071426',
        '--wgs-question-bg': '#071426',
        '--wgs-exam-card': '#0b1727',
    },
};

const THEME_TONE_ALPHA_TOKENS = {
    light: {
        '--wgs-panel': 0.86,
        '--wgs-card': 0.92,
        '--wgs-card-soft': 0.92,
        '--wgs-panel-soft': 0.88,
        '--wgs-button-muted': 0.88,
        '--wgs-input-bg': 0.96,
    },
    dark: {
        '--wgs-panel': 0.88,
        '--wgs-card': 0.92,
        '--wgs-card-soft': 0.82,
        '--wgs-panel-soft': 0.72,
        '--wgs-button-muted': 0.92,
        '--wgs-input-bg': 0.92,
    },
};

const THEME_TONE_MIX_LIMITS = {
    light: { dim: 0.24, brighten: 0.10 },
    dark: { dim: 0.72, brighten: 0.36 },
};

export const clampThemeTone = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return THEME_TONE_DEFAULT;

    const steppedValue = Math.round(numericValue / THEME_TONE_STEP) * THEME_TONE_STEP;
    return Math.min(THEME_TONE_MAX, Math.max(THEME_TONE_MIN, steppedValue));
};

export const getThemeToneStorageKey = (mode) => THEME_TONE_STORAGE_KEYS[mode === 'dark' ? 'dark' : 'light'];

export const getStoredThemeTone = (mode) => {
    const savedValue = sessionStorage.getItem(getThemeToneStorageKey(mode));
    return clampThemeTone(savedValue ?? THEME_TONE_DEFAULT);
};

const hexToRgb = (hexColor) => {
    const cleanHex = String(hexColor || '').replace('#', '');
    const fullHex = cleanHex.length === 3
        ? cleanHex.split('').map((char) => `${char}${char}`).join('')
        : cleanHex;
    const parsedValue = Number.parseInt(fullHex, 16);

    if (!Number.isFinite(parsedValue)) return [0, 0, 0];
    return [
        (parsedValue >> 16) & 255,
        (parsedValue >> 8) & 255,
        parsedValue & 255,
    ];
};

const mixRgb = (baseRgb, targetRgb, ratio) => (
    baseRgb.map((channel, index) => Math.round(channel + (targetRgb[index] - channel) * ratio))
);

const toRgbText = ([red, green, blue], alpha) => (
    alpha === undefined
        ? `rgb(${red}, ${green}, ${blue})`
        : `rgba(${red}, ${green}, ${blue}, ${alpha})`
);

const adjustThemeRgb = (hexColor, tone, mode) => {
    const toneDelta = clampThemeTone(tone) - THEME_TONE_DEFAULT;
    const baseRgb = hexToRgb(hexColor);
    if (toneDelta === 0) return baseRgb;

    const normalizedMode = mode === 'dark' ? 'dark' : 'light';
    const limit = toneDelta > 0
        ? THEME_TONE_MIX_LIMITS[normalizedMode].brighten
        : THEME_TONE_MIX_LIMITS[normalizedMode].dim;
    const range = toneDelta > 0
        ? THEME_TONE_MAX - THEME_TONE_DEFAULT
        : THEME_TONE_DEFAULT - THEME_TONE_MIN;
    const targetRgb = toneDelta > 0 ? [255, 255, 255] : [0, 0, 0];
    const mixRatio = (Math.abs(toneDelta) / range) * limit;

    return mixRgb(baseRgb, targetRgb, mixRatio);
};

export const buildThemeToneVariables = (mode, tone) => {
    const normalizedMode = mode === 'dark' ? 'dark' : 'light';
    const baseTokens = THEME_TONE_BASE_TOKENS[normalizedMode];
    const alphaTokens = THEME_TONE_ALPHA_TOKENS[normalizedMode];

    return Object.entries(baseTokens).reduce((nextTokens, [tokenName, tokenValue]) => {
        const adjustedRgb = adjustThemeRgb(tokenValue, tone, normalizedMode);
        const alpha = alphaTokens[tokenName];

        nextTokens[tokenName] = alpha === undefined
            ? toRgbText(adjustedRgb)
            : toRgbText(adjustedRgb, alpha);
        return nextTokens;
    }, {
        '--wgs-theme-tone': String(clampThemeTone(tone)),
    });
};
