// 회식맵 기능 모듈입니다: useMealMapKakaoMap
import { useEffect, useRef, useState } from 'react';
import {
  KAKAO_MAP_DEFAULT_CENTER,
  KAKAO_MAP_DEFAULT_LEVEL,
  KAKAO_MAP_MAX_AUTO_LEVEL,
  KAKAO_MAP_SINGLE_PLACE_LEVEL,
  getPlaceMarkerText,
} from './mealMapUtils.js';

export default function useMealMapKakaoMap({ config, places, selectedPlace, setSelectedPlace }) {
  const [mapStatus, setMapStatus] = useState('idle');
  const [mapDebug, setMapDebug] = useState('');

  const mapRef = useRef(null);
  const kakaoMapCanvasRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const markerRefs = useRef([]);

  // enhanced SDK diagnostics =====
  // 실제 카카오 지도는 전용 canvas div에만 그립니다.
  // 기존 목업 지도 wrapper와 섞이지 않게 분리해서 빈 지도/하늘색 배경만 보이는 문제를 줄입니다.
  useEffect(() => {
    if (!config.mapEnabled || !config.mapClientId) {
      setMapDebug('');
      setMapStatus('mock');
      return undefined;
    }
    if (!kakaoMapCanvasRef.current) return undefined;

    const appKey = String(config.mapClientId || '').trim();
    if (!appKey) {
      setMapStatus('error');
      return undefined;
    }

    const scriptId = 'wgs-kakao-map-script';
    let cancelled = false;
    let timeoutId = null;
    let initialized = false;

    const markError = (reason) => {
      if (cancelled) return;
      const nextReason = String(reason || 'unknown');
      console.warn('[mealmap] kakao map render failed:', nextReason);
      setMapDebug(nextReason);
      setMapStatus('error');
    };

    const initKakaoMap = () => {
      if (cancelled) return;
      if (!window.kakao?.maps?.Map || !kakaoMapCanvasRef.current) {
        markError('Kakao map SDK is not available. Check JavaScript key and Web platform domain.');
        return;
      }

      try {
        kakaoMapRef.current = new window.kakao.maps.Map(kakaoMapCanvasRef.current, {
          center: new window.kakao.maps.LatLng(KAKAO_MAP_DEFAULT_CENTER.lat, KAKAO_MAP_DEFAULT_CENTER.lng),
          level: KAKAO_MAP_DEFAULT_LEVEL,
        });
        kakaoMapRef.current.addControl(new window.kakao.maps.ZoomControl(), window.kakao.maps.ControlPosition.RIGHT);
        initialized = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        setMapDebug('');
        setMapStatus('ready');

        setTimeout(() => {
          try {
            kakaoMapRef.current?.relayout?.();
          } catch (err) {
            console.warn('[mealmap] kakao map relayout skipped:', err);
          }
        }, 80);
      } catch (err) {
        markError(err?.message || err);
      }
    };

    const loadKakaoMap = () => {
      if (cancelled) return;
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(initKakaoMap);
        return;
      }
      if (window.kakao?.maps?.Map) {
        initKakaoMap();
        return;
      }
      markError('window.kakao.maps.load is not available.');
    };

    setMapDebug('카카오 SDK 스크립트를 불러오는 중입니다. 8초 이상 지속되면 JavaScript 키, Web 플랫폼 도메인, 카카오맵 활성화 상태를 확인해주세요.');
    setMapStatus('loading');
    timeoutId = window.setTimeout(() => {
      if (!cancelled && !initialized) {
        markError('Kakao map SDK load timeout.');
      }
    }, 8000);

    const oldScript = document.getElementById(scriptId);
    if (oldScript && oldScript.dataset.appkey && oldScript.dataset.appkey !== appKey) {
      oldScript.remove();
      delete window.kakao;
      kakaoMapRef.current = null;
    }

    const existing = document.getElementById(scriptId);
    if (existing) {
      existing.addEventListener('load', loadKakaoMap);
      loadKakaoMap();
      return () => {
        cancelled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        existing.removeEventListener('load', loadKakaoMap);
      };
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.dataset.appkey = appKey;
    const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
    window.__WGS_MEALMAP_KAKAO_DEBUG__ = {
      provider: 'kakao',
      appKeyMask: `${appKey.slice(0, 4)}...${appKey.slice(-4)}`,
      sdkUrlPreview: `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey.slice(0, 4)}...${appKey.slice(-4)}&libraries=services&autoload=false`,
      origin: window.location.origin,
    };
    script.src = sdkUrl;
    script.async = true;
    script.onload = loadKakaoMap;
    script.onerror = () => markError('Kakao map script network error.');
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      script.onload = null;
      script.onerror = null;
    };
  }, [config.mapEnabled, config.mapClientId]);

  useEffect(() => {
    if (!kakaoMapRef.current || !window.kakao?.maps || mapStatus !== 'ready') return;

    markerRefs.current.forEach((item) => {
      try {
        if (item?.marker) item.marker.setMap(null);
        if (item?.overlay) item.overlay.setMap(null);
      } catch (err) {
        console.warn('[mealmap] kakao marker cleanup skipped:', err);
      }
    });
    markerRefs.current = [];

    const bounds = new window.kakao.maps.LatLngBounds();
    let hasBounds = false;
    let validPlaceCount = 0;
    let onlyPosition = null;

    places.forEach((place) => {
      const lat = Number(place.lat);
      const lng = Number(place.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const position = new window.kakao.maps.LatLng(lat, lng);
      onlyPosition = position;
      bounds.extend(position);
      hasBounds = true;
      validPlaceCount += 1;

      const marker = new window.kakao.maps.Marker({
        map: kakaoMapRef.current,
        position,
        title: place.name || '회식 장소',
      });

      const labelButton = document.createElement('button');
      labelButton.type = 'button';
      labelButton.className = 'mealmap-kakao-marker-label';
      labelButton.textContent = getPlaceMarkerText(place);
      labelButton.addEventListener('click', () => setSelectedPlace(place));

      const overlay = new window.kakao.maps.CustomOverlay({
        map: kakaoMapRef.current,
        position,
        content: labelButton,
        yAnchor: 1.85,
        zIndex: 4,
      });

      window.kakao.maps.event.addListener(marker, 'click', () => setSelectedPlace(place));
      markerRefs.current.push({ marker, overlay });
    });

    if (hasBounds) {
      if (validPlaceCount === 1 && onlyPosition) {
        kakaoMapRef.current.setCenter(onlyPosition);
        kakaoMapRef.current.setLevel(KAKAO_MAP_SINGLE_PLACE_LEVEL);
      } else {
        kakaoMapRef.current.setBounds(bounds);
        const currentLevel = kakaoMapRef.current.getLevel?.();
        if (Number(currentLevel) >KAKAO_MAP_MAX_AUTO_LEVEL) {
          kakaoMapRef.current.setLevel(KAKAO_MAP_MAX_AUTO_LEVEL);
        }
      }
    } else {
      kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(KAKAO_MAP_DEFAULT_CENTER.lat, KAKAO_MAP_DEFAULT_CENTER.lng));
      kakaoMapRef.current.setLevel(KAKAO_MAP_DEFAULT_LEVEL);
    }

    setTimeout(() => kakaoMapRef.current?.relayout?.(), 60);
  }, [places, mapStatus, setSelectedPlace]);

  useEffect(() => {
    if (!selectedPlace || !kakaoMapRef.current || !window.kakao?.maps || mapStatus !== 'ready') return;
    const lat = Number(selectedPlace.lat);
    const lng = Number(selectedPlace.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    kakaoMapRef.current.panTo(new window.kakao.maps.LatLng(lat, lng));
  }, [selectedPlace, mapStatus]);


  return {
    mapRef,
    kakaoMapCanvasRef,
    mapStatus,
    mapDebug,
  };
}
