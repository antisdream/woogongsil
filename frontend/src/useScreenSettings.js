// 관리자에서 관리하는 화면 설정을 페이지 컴포넌트에 불러옵니다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_BASE = '';

// 기존 캐시가 잘못된 settingsMap 구조를 들고 있을 수 있으므로 v2 캐시 키를 사용합니다.
const SCREEN_SETTINGS_CACHE_PREFIX = 'wgsScreenSettingsCache:v2:';

// 관리자 API가 내려주는 설정값을 프론트에서 쉽게 찾을 수 있도록 평평한 구조로 정리합니다.
// 지원하는 형태:
// 1) { global: { site_title: '...' } }
// 2) { 'global.site_title': '...' }
// 3) { 'all.global.site_title': '...' }
// 4) { 'home.hero.hero_title': '...' }
const buildFlatSettings = (settingsMap = {}) => {
    const flat = {};

    Object.entries(settingsMap || {}).forEach(([rawKey, rawValue]) => {
        if (!rawKey) return;

        // 중첩 객체 형태 처리: { global: { site_title: '...' } }
        if (
            rawValue &&
            typeof rawValue === 'object' &&
            !Array.isArray(rawValue)
        ) {
            Object.entries(rawValue).forEach(([childKey, childValue]) => {
                const fullKey = `${rawKey}.${childKey}`;
                flat[fullKey] = childValue;
                flat[childKey] = childValue;
            });
            return;
        }

        // 평평한 key-value 형태 처리: { 'global.site_title': '...' }
        const key = String(rawKey);
        const value = rawValue;

        flat[key] = value;

        const parts = key.split('.').filter(Boolean);

        // all.global.site_title ->global.site_title, site_title
        // home.hero.hero_title ->hero.hero_title, hero_title
        if (parts.length >= 3) {
            const withoutPageKey = parts.slice(1).join('.');
            const lastKey = parts[parts.length - 1];

            flat[withoutPageKey] = value;
            flat[lastKey] = value;
        }

        // global.site_title ->site_title
        // hero.hero_title ->hero_title
        if (parts.length === 2) {
            flat[parts[1]] = value;
        }
    });

    return flat;
};

const getCachedSettings = (pageKey) => {
    try {
        const raw = localStorage.getItem(`${SCREEN_SETTINGS_CACHE_PREFIX}${pageKey}`);
        if (!raw) return {};

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object'? parsed : {};
    } catch (error) {
        return {};
    }
};

const saveCachedSettings = (pageKey, settingsMap) => {
    try {
        localStorage.setItem(`${SCREEN_SETTINGS_CACHE_PREFIX}${pageKey}`, JSON.stringify(settingsMap || {}));
    } catch (error) {
        // localStorage 사용이 막힌 환경에서는 캐시 없이 서버 기본값만 사용합니다.
    }
};

export const resolveWgsAssetUrl = (value = '') => {
    const raw = String(value || '').trim();

    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;

    return `/${raw.replace(/^public\//, '')}`;
};

const shouldRefetchByPayload = (payload, pageKey) => {
    if (!payload || !pageKey) return true;

    const changedPageKey = payload.page_key || payload.pageKey || '';

    if (!changedPageKey) return true;

    // all은 전체 공통 설정이므로 모든 페이지에서 다시 불러옵니다.
    return changedPageKey === 'all' || changedPageKey === pageKey;
};

function useScreenSettings(pageKey = 'all') {
    const normalizedPageKey = String(pageKey || 'all').trim() || 'all';

    const [settingsMap, setSettingsMap] = useState(() => getCachedSettings(normalizedPageKey));
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const refreshSettings = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            const res = await axios.get(`${API_BASE}/api/screen-settings`, {
                params: { page_key: normalizedPageKey }
            });

            if (res.data?.ok) {
                const nextSettingsMap = res.data.settingsMap || {};
                setSettingsMap(nextSettingsMap);
                saveCachedSettings(normalizedPageKey, nextSettingsMap);
                return nextSettingsMap;
            }

            throw new Error(res.data?.message || '화면 설정을 불러오지 못했습니다.');
        } catch (err) {
            const message = err.response?.data?.message || err.message || '화면 설정을 불러오지 못했습니다.';
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [normalizedPageKey]);

    useEffect(() => {
        refreshSettings();
    }, [refreshSettings]);

    useEffect(() => {
        const socket = io(API_BASE || window.location.origin, {
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        const handleUpdated = (payload) => {
            if (shouldRefetchByPayload(payload, normalizedPageKey)) {
                refreshSettings();
            }
        };

        socket.on('screen-settings-updated', handleUpdated);

        return () => {
            socket.off('screen-settings-updated', handleUpdated);
            socket.disconnect();
        };
    }, [normalizedPageKey, refreshSettings]);

    const flatSettings = useMemo(() => buildFlatSettings(settingsMap), [settingsMap]);

    const getSetting = useCallback((path, fallback = '') => {
        if (!path) return fallback;

        const key = String(path);

        // 찾는 우선순위
        // 1. hero.hero_title
        // 2. home.hero.hero_title
        // 3. all.hero.hero_title
        // 4. site_title 같은 마지막 키
        const candidates = [
            key,
            `${normalizedPageKey}.${key}`,
            `all.${key}`,
            key.split('.').filter(Boolean).pop()
        ].filter(Boolean);

        for (const candidate of candidates) {
            if (Object.prototype.hasOwnProperty.call(flatSettings, candidate)) {
                const value = flatSettings[candidate];
                return value === null || value === undefined || value === ''? fallback : value;
            }
        }

        return fallback;
    }, [flatSettings, normalizedPageKey]);

    return {
        settingsMap,
        flatSettings,
        getSetting,
        refreshSettings,
        isLoading,
        error
    };
}

export default useScreenSettings;
