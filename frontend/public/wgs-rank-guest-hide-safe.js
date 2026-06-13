(function () {
  'use strict';

  // React 상태를 바꾸지 않고 비회원에게 홈 랭킹 패널을 숨깁니다.
  // 이 공개 보정 스크립트는 SPA 번들 뒤에 실행되며 DOM 오류가 나도 조용히 종료됩니다.
  var STYLE_ID = 'wgs-ranking-guest-hide-style';
  var HIDDEN_CLASS = 'wgs-ranking-guest-hidden-safe';

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + HIDDEN_CLASS + ' {' +
      'display: none !important;' +
      'visibility: hidden !important;' +
      'height: 0 !important;' +
      'min-height: 0 !important;' +
      'margin: 0 !important;' +
      'padding: 0 !important;' +
      'overflow: hidden !important;' +
      '}';
    document.head.appendChild(style);
  }

  function hasLoginStateFromStorage() {
    try {
      var keys = [
        'user',
        'currentUser',
        'loginUser',
        'loggedInUser',
        'wgsUser',
        'authUser',
        'member',
        'profile'
      ];

      for (var i = 0; i < keys.length; i += 1) {
        var localValue = window.localStorage.getItem(keys[i]);
        var sessionValue = window.sessionStorage.getItem(keys[i]);

        if (isUsefulUserValue(localValue) || isUsefulUserValue(sessionValue)) {
          return true;
        }
      }
    } catch (err) {}

    return false;
  }

  function isUsefulUserValue(value) {
    if (!value) return false;

    var normalized = String(value).trim();
    if (!normalized) return false;
    if (normalized === 'null') return false;
    if (normalized === 'undefined') return false;
    if (normalized === '{}') return false;
    if (normalized === '[]') return false;

    return true;
  }

  function isLoggedIn() {
    var bodyText = '';

    try {
      bodyText = document.body ? document.body.innerText || '' : '';
    } catch (err) {
      bodyText = '';
    }

    // 실제 로그인 상태에서 홈 상단에 보이는 문구 기준
    if (bodyText.indexOf('로그아웃') !== -1) return true;
    if (bodyText.indexOf('로그인 유지') !== -1) return true;

    return hasLoginStateFromStorage();
  }

  function includesAll(text, words) {
    for (var i = 0; i < words.length; i += 1) {
      if (text.indexOf(words[i]) === -1) return false;
    }
    return true;
  }

  function findRankingRoot() {
    if (!document.body) return null;

    var requiredWords = [
      '나의 점수는?',
      '오늘의 필기 문제은행 Top 3',
      '나의 실시간 랭킹'
    ];

    var nodes = Array.prototype.slice.call(
      document.querySelectorAll('section, article, div')
    );

    var best = null;

    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var text = '';

      try {
        text = (el.innerText || '').replace(/\s+/g, ' ');
      } catch (err) {
        text = '';
      }

      if (!includesAll(text, requiredWords)) continue;

      // 달력 전체 wrapper까지 올라간 요소는 제외
      if (text.indexOf('2026년 5월') !== -1) continue;
      if (text.indexOf('Today') !== -1 && text.indexOf('개인 랭킹 히스토리') !== -1) continue;

      var rect = el.getBoundingClientRect();
      var area = rect.width * rect.height;

      if (rect.width < 500) continue;
      if (rect.height < 120) continue;
      if (rect.height >1800) continue;

      if (!best || area >best.area) {
        best = {
          el: el,
          area: area
        };
      }
    }

    return best ? best.el : null;
  }

  function clearWrongCalendarHide() {
    // 혹시 이전 작업에서 달력에 숨김 클래스가 붙었을 경우 제거
    var hiddenNodes = Array.prototype.slice.call(
      document.querySelectorAll('.' + HIDDEN_CLASS)
    );

    for (var i = 0; i < hiddenNodes.length; i += 1) {
      var text = '';
      try {
        text = hiddenNodes[i].innerText || '';
      } catch (err) {
        text = '';
      }

      if (text.indexOf('2026년 5월') !== -1 || text.indexOf('Today') !== -1) {
        hiddenNodes[i].classList.remove(HIDDEN_CLASS);
      }
    }
  }

  function applyRankingVisibility() {
    try {
      addStyle();
      clearWrongCalendarHide();

      var rankingRoot = findRankingRoot();
      if (!rankingRoot) return;

      if (isLoggedIn()) {
        rankingRoot.classList.remove(HIDDEN_CLASS);
      } else {
        rankingRoot.classList.add(HIDDEN_CLASS);
      }
    } catch (err) {
      // 화면 백지 방지용: 어떤 오류가 나도 React 렌더링을 막지 않음
      console.warn('[WGS] ranking guest hide skipped:', err);
    }
  }

  function scheduleApply() {
    window.setTimeout(applyRankingVisibility, 100);
    window.setTimeout(applyRankingVisibility, 500);
    window.setTimeout(applyRankingVisibility, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleApply);
  } else {
    scheduleApply();
  }

  if (window.MutationObserver) {
    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) return;

      timer = window.setTimeout(function () {
        timer = null;
        applyRankingVisibility();
      }, 300);
    });

    function startObserver() {
      if (!document.body) return;
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (document.body) {
      startObserver();
    } else {
      document.addEventListener('DOMContentLoaded', startObserver);
    }
  }
})();
