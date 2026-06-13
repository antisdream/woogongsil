(function () {
  'use strict';

  // 달력 표시 안정화 스크립트입니다.
  // - React 상태를 직접 변경하지 않습니다.
  // - 특정 연월일을 하드코딩하지 않습니다.
  // - 공휴일/휴무일 라벨과 날짜 숫자만 빨간색으로 표시합니다.
  // - 화면에 보이는 달력 문구에서 중복되거나 남은 "일차 - " 접두어를 제거합니다.
  // - DOM 파싱 문제가 생겨도 페이지가 비어 보이지 않도록 조용히 종료합니다.

  var HOLIDAY_WORDS = [
    '공휴일',
    '대체공휴일',
    '대체 휴일',
    '어린이날',
    '부처님오신날',
    '부처님 오신 날',
    '석가탄신일',
    '현충일',
    '광복절',
    '개천절',
    '한글날',
    '추석',
    '추석 연휴',
    '설날',
    '설 연휴',
    '삼일절',
    '3.1절',
    '크리스마스',
    '성탄절',
    '선거',
    '지방선거',
    '대통령선거',
    '국회의원선거'
  ];

  function cleanText(value) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();

    // "일차 - 어린이날", "일차 - 민지 필기시험" 같은 잘못된 접두어 제거
    text = text.replace(/^일차\s*[-–—]\s*/u, '');

    // "37일차 - 37일차 ..." 중복 제거
    text = text.replace(/^(\d+일차)\s*[-–—]\s*\1\s*/u, '$1 - ');
    text = text.replace(/^(\d+일차)\s*[-–—]\s*(\d+일차)\s*/u, '$1 - ');

    return text.trim();
  }

  function hasHolidayWord(text) {
    var t = String(text || '');
    return HOLIDAY_WORDS.some(function (word) {
      return t.indexOf(word) !== -1;
    });
  }

  function setImportant(el, prop, value) {
    if (!el || !el.style) return;
    el.style.setProperty(prop, value, 'important');
  }

  function paintRedText(el) {
    if (!el || !el.style) return;
    setImportant(el, 'color', '#ff3b3b');
    setImportant(el, 'font-weight', '700');
  }

  function removeHolidayPillBackground(el) {
    if (!el || !el.style) return;
    setImportant(el, 'background', 'transparent');
    setImportant(el, 'background-color', 'transparent');
    setImportant(el, 'box-shadow', 'none');
    setImportant(el, 'border', '0');
    setImportant(el, 'padding-left', '0');
    setImportant(el, 'padding-right', '0');
  }

  function getCurrentYearMonth() {
    var text = document.body && document.body.innerText ? document.body.innerText : '';
    var m = text.match(/(20\d{2})년\s*(\d{1,2})월/);
    if (!m) return null;
    return {
      year: Number(m[1]),
      month: Number(m[2])
    };
  }

  function isNumericDayText(text) {
    return /^(?:[1-9]|[12]\d|3[01])$/.test(String(text || '').trim());
  }

  function findDayCell(fromEl) {
    var cur = fromEl;

    for (var depth = 0; cur && depth < 10; depth += 1) {
      var rect = cur.getBoundingClientRect ? cur.getBoundingClientRect() : null;

      if (rect && rect.width >80 && rect.height >60) {
        var numericLeaf = Array.prototype.slice.call(cur.querySelectorAll('*')).some(function (node) {
          if (!node || node.childElementCount !== 0) return false;
          return isNumericDayText(node.innerText || node.textContent || '');
        });

        if (numericLeaf) {
          return cur;
        }
      }

      cur = cur.parentElement;
    }

    return null;
  }

  function markDayNumberInCell(cell, forceRed) {
    if (!cell) return;

    var ym = getCurrentYearMonth();

    Array.prototype.slice.call(cell.querySelectorAll('*')).forEach(function (node) {
      if (!node || node.childElementCount !== 0) return;

      var text = String(node.innerText || node.textContent || '').trim();
      if (!isNumericDayText(text)) return;

      var day = Number(text);
      var shouldRed = !!forceRed;

      // 일요일은 연/월/일 계산으로 빨간색 처리합니다. 날짜 하드코딩 아님.
      if (ym && day >= 1 && day <= 31) {
        var d = new Date(ym.year, ym.month - 1, day);
        if (d && d.getDay && d.getDay() === 0) {
          shouldRed = true;
        }
      }

      if (shouldRed) {
        paintRedText(node);
      }
    });
  }

  function cleanTextNodes(root) {
    var walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          var tag = parent.tagName ? parent.tagName.toLowerCase() : '';
          if (['script', 'style', 'textarea', 'input', 'option'].indexOf(tag) !== -1) {
            return NodeFilter.FILTER_REJECT;
          }

          var value = String(node.nodeValue || '');
          if (!value.trim()) return NodeFilter.FILTER_REJECT;

          if (
            /^일차\s*[-–—]/u.test(value.trim()) ||
            /^(\d+일차)\s*[-–—]\s*(\d+일차)/u.test(value.trim())
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }

          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    var node;
    var targets = [];

    while ((node = walker.nextNode())) {
      targets.push(node);
    }

    targets.forEach(function (node) {
      var before = String(node.nodeValue || '');
      var after = cleanText(before);
      if (after && before.trim() !== after) {
        node.nodeValue = before.replace(before.trim(), after);
      }
    });
  }

  function applyHolidayPolish() {
    try {
      if (!document.body) return;

      cleanTextNodes(document.body);

      var all = Array.prototype.slice.call(document.querySelectorAll('*'));

      all.forEach(function (el) {
        if (!el || !el.getBoundingClientRect) return;

        var text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return;

        // leaf 텍스트 중심으로만 처리해서 다른 UI 오염 방지
        if (el.childElementCount === 0) {
          var cleaned = cleanText(text);

          if (cleaned !== text && el.firstChild && el.firstChild.nodeType === 3) {
            el.firstChild.nodeValue = cleaned;
            text = cleaned;
          }

          if (hasHolidayWord(text)) {
            var cell = findDayCell(el);

            // 공휴일 텍스트 자체는 빨간색 + 배경 제거
            paintRedText(el);
            removeHolidayPillBackground(el);

            // 공휴일 pill 부모 배경도 제거하되, 달력 셀 전체는 변경하지 않습니다
            var cur = el.parentElement;
            for (var depth = 0; cur && cur !== cell && depth < 5; depth += 1) {
              removeHolidayPillBackground(cur);
              paintRedText(cur);
              cur = cur.parentElement;
            }

            // 해당 날짜 숫자도 빨간색
            if (cell) {
              markDayNumberInCell(cell, true);
            }
          }
        }
      });

      // 일요일 날짜 숫자 빨간색
      var numericNodes = all.filter(function (el) {
        return el && el.childElementCount === 0 && isNumericDayText(el.innerText || el.textContent || '');
      });

      numericNodes.forEach(function (numEl) {
        var cell = findDayCell(numEl);
        if (cell) {
          markDayNumberInCell(cell, false);
        }
      });
    } catch (error) {
      console.warn('[WGS] calendar holiday polish skipped:', error);
    }
  }

  var scheduled = false;

  function scheduleApply() {
    if (scheduled) return;

    scheduled = true;

    window.requestAnimationFrame(function () {
      scheduled = false;
      applyHolidayPolish();
    });
  }

  function start() {
    try {
      scheduleApply();

      var observer = new MutationObserver(function () {
        scheduleApply();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      // 월 이동 직후 렌더 지연 대응
      var count = 0;
      var timer = window.setInterval(function () {
        count += 1;
        scheduleApply();

        if (count >= 20) {
          window.clearInterval(timer);
        }
      }, 300);
    } catch (error) {
      console.warn('[WGS] calendar holiday observer skipped:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.addEventListener('load', scheduleApply);
})();
