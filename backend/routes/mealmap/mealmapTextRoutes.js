// Mealmap text-management routes.
'use strict';

function registerMealmapTextRoutes(options = {}) {
  const app = options.app;
  const pool = options.pool;
  const validateAdminSession = options.validateAdminSession;

  const required = { app, pool, validateAdminSession };
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === null)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`registerMealmapTextRoutes missing dependencies: ${missing.join(', ')}`);
  }

// ============================== //
// 회식맵 페이지 문구를 관리자 페이지에서 관리하기 위한 안전한 키-값 설정입니다.
// 기존 회식맵 장소/댓글/좋아요/수정제안 로직과 분리되어 작동합니다.
const MEALMAP_DEFAULT_TEXTS = {
  "heroEyebrow": "회식 장소 추천",
  "heroTitle": "회식맵",
  "heroSubtitle": "제보한 장소는 바로 공개되고, 수정·삭제 요청은 관리자 검토 후 반영됩니다.",
  "submitButton": "장소 제보",
  "searchPlaceholder": "식당명, 주소, 메뉴 검색",
  "searchButton": "검색",
  "filterButton": "필터",
  "mapTitle": "지도 API 미설정 목업 모드",
  "mapCountPrefix": "공개 장소",
  "mapCountText": "공개 장소 {count}개",
  "mapGuideTitle": "안내: 가격과 식당명을 표시합니다.",
  "mapGuideBody": "카카오 지도 API 키를 연결하기 전까지 목업 지도에서 기능 흐름을 확인할 수 있습니다.",
  "emptyTitle": "등록된 식당이 없습니다.",
  "emptyBody": "첫 회식 장소를 제보하면 이 영역에 바로 표시됩니다.",
  "selectMarkerTitle": "마커를 선택하면 상세 정보가 표시됩니다.",
  "selectMarkerBody": "식당 정보, 가격, 댓글, 지도 링크가 표시됩니다.",
  "naverButton": "카카오지도/후기 보기",
  "likeButton": "좋아요",
  "editSuggestButton": "수정 제안",
  "deleteSuggestButton": "삭제 요청",
  "commentTitle": "댓글",
  "commentPlaceholder": "댓글 입력...",
  "commentSubmitButton": "등록",
  "editModalEyebrow": "사용자 수정 제안",
  "editModalSubtext": "관리자 승인 후 회식맵에 반영됩니다.",
  "editReasonLabel": "수정 이유",
  "editReasonPlaceholder": "예: 가격 변경, 영업시간 변경, 주소 오기입 등",
  "editSubmitButton": "수정 제안 보내기",
  "editCancelButton": "취소",
  "editSuccessMessage": "수정 제안이 접수되었습니다. 관리자 승인 후 반영됩니다.",
  "kakaoMapModeTitle": "카카오 지도 모드",
  "loadingText": "불러오는 중...",
  "kakaoMapAriaLabel": "카카오 지도",
  "kakaoMapLoadingTitle": "카카오 지도를 불러오는 중입니다.",
  "kakaoMapLoadingBody": "잠시 후에도 보이지 않으면 카카오 JavaScript 키와 Web 플랫폼 도메인을 확인해주세요.",
  "kakaoMapErrorTitle": "카카오 지도를 불러오지 못했습니다.",
  "kakaoMapErrorBody": "카카오 Developers의 Web 플랫폼 도메인에 현재 주소가 등록되어 있는지, JavaScript 키가 맞는지 확인해주세요.",
  "kakaoMapDebugHint": "점검 주소: /api/mealmap/kakao/js-test",
  "clusterZoomOutTitle": "줌아웃: 등록 개수 표시",
  "clusterZoomInTitle": "줌인: 가격/식당명 표시",
  "detailCloseAria": "상세 닫기",
  "detailUnknownCategory": "식당",
  "detailEmptyValue": "-",
  "closeButton": "닫기",
  "priceLabel": "가격",
  "openingHoursLabel": "영업시간",
  "mainMenuLabel": "대표메뉴",
  "reporterLabel": "제보자",
  "activityHistoryButton": "활동 이력",
  "commentLoadingText": "댓글 불러오는 중...",
  "commentEmptyText": "아직 등록된 댓글이 없습니다.",
  "placeLoadFailMessage": "회식맵 장소를 불러오지 못했습니다.",
  "commentLoadFailMessage": "댓글을 불러오지 못했습니다.",
  "geocodeAddressRequiredMessage": "주소를 먼저 입력해주세요.",
  "geocodeFailMessage": "주소 좌표를 찾지 못했습니다.",
  "geocodeFormSuccessMessage": "주소 기준 좌표를 찾았습니다. 내용을 확인한 뒤 바로 등록해주세요.",
  "geocodeEditSuccessMessage": "주소 기준 좌표를 찾았습니다. 수정 내용을 확인한 뒤 제안해주세요.",
  "keywordRequiredMessage": "카카오 장소 검색어를 입력해주세요.",
  "keywordEmptyMessage": "카카오 장소 검색 결과가 없습니다. 주소 검색을 함께 사용해주세요.",
  "keywordErrorMessage": "카카오 장소 검색 중 오류가 발생했습니다.",
  "keywordAppliedMessage": "카카오 장소 검색 결과가 입력되었습니다. 필요하면 내용을 확인 후 수정해주세요.",
  "reportLoginRequiredMessage": "로그인 후 장소를 제보할 수 있습니다.",
  "reportRequiredFieldsMessage": "식당명과 주소는 필수입니다.",
  "reportSubmitFailMessage": "장소 제보에 실패했습니다.",
  "reportSubmitSuccessMessage": "장소 제보가 등록되어 회식맵에 바로 공개되었습니다.",
  "commentLoginRequiredMessage": "로그인 후 댓글을 남길 수 있습니다.",
  "commentSubmitFailMessage": "댓글 등록에 실패했습니다.",
  "commentSubmitSuccessMessage": "댓글이 등록되었습니다.",
  "likeLoginRequiredMessage": "로그인 후 좋아요를 누를 수 있습니다.",
  "likeFailMessage": "좋아요 처리에 실패했습니다.",
  "likeSuccessMessage": "좋아요가 반영되었습니다.",
  "likeCancelMessage": "좋아요가 취소되었습니다.",
  "editRequiredFieldsMessage": "식당명과 주소를 입력해주세요.",
  "editPriceRangeMessage": "최대 가격은 최소 가격보다 작을 수 없습니다.",
  "editDefaultReason": "사용자가 식당 정보 수정을 제안했습니다.",
  "editSubmitFailShortMessage": "수정 제안 접수 실패",
  "editSubmitSuccessMessage": "수정 제안이 접수되었습니다.",
  "editSubmitFailMessage": "수정 제안 접수에 실패했습니다.",
  "deleteRequestPrompt": "삭제 요청 사유를 입력해주세요. 관리자 승인 후 숨김 처리됩니다.",
  "deleteRequestConfirm": "이 식당의 삭제 요청을 관리자 결재 대기 목록에 등록할까요?",
  "deleteRequestSuccessMessage": "삭제 요청이 접수되었습니다. 관리자 승인 후 숨김 처리됩니다.",
  "deleteRequestFailMessage": "삭제 요청 접수에 실패했습니다.",
  "activityLoginRequiredMessage": "로그인 후 활동 이력을 확인할 수 있습니다.",
  "activityModalEyebrow": "회식맵 활동 이력",
  "activityModalTitle": "제보/수정 제안 처리 내역",
  "activityModalSubtext": "승인 대기, 승인 완료, 반려 상태를 확인하고 반려된 요청은 이전 입력 내용으로 다시 제출할 수 있습니다.",
  "activityLoadingText": "활동 이력을 불러오는 중입니다.",
  "activityEmptyText": "아직 등록된 회식맵 제보/수정 제안 이력이 없습니다.",
  "activityColumnNo": "No",
  "activityColumnType": "유형",
  "activityColumnStatus": "상태",
  "activityColumnPlaceName": "식당명",
  "activityColumnAddress": "주소",
  "activityColumnPrice": "가격",
  "activityColumnOpeningHours": "운영시간",
  "activityColumnMainMenu": "대표메뉴",
  "activityColumnRequestedAt": "요청일시",
  "activityColumnProcessedAt": "처리일시",
  "activityColumnResult": "처리 결과",
  "activityColumnAction": "상세/다시 요청",
  "activityTypeReport": "장소 제보",
  "activityTypeEdit": "수정 제안",
  "activityStatusPending": "승인 대기",
  "activityStatusApproved": "승인 완료",
  "activityStatusRejected": "반려",
  "activityStatusHidden": "숨김",
  "activityResubmitEditButton": "다시 수정 제안",
  "activityResubmitReportButton": "다시 제보하기",
  "activityDetailText": "상세 확인",
  "activityTotalText": "전체 {count}건",
  "activityPrevButton": "이전",
  "activityNextButton": "다음",
  "filterModalTitle": "상세 필터 설정",
  "filterMinBudgetLabel": "최소 예산",
  "filterMaxBudgetLabel": "최대 예산",
  "filterResetButton": "초기화",
  "filterApplyButton": "적용",
  "addModalTitle": "장소 제보하기",
  "loginRequiredText": "로그인 후 제보할 수 있습니다.",
  "formNameLabel": "식당명 *",
  "formCategoryLabel": "카테고리",
  "formAddressLabel": "주소 *",
  "formKeywordSearchLabel": "카카오 장소 키워드 검색",
  "formKeywordPlaceholder": "예: 동남집 독산점, 가산디지털단지역 국밥",
  "formGeocodingText": "좌표 찾는 중...",
  "formGeocodeButton": "주소로 좌표 찾기",
  "formLookupSearchingText": "검색 중...",
  "formLookupButton": "키워드로 좌표 찾기",
  "formLookupEmptyName": "이름 없음",
  "formLookupEmptyAddress": "주소 정보 없음",
  "formMinPriceLabel": "최소가격",
  "formMaxPriceLabel": "최대가격",
  "formMainMenuLabel": "대표메뉴",
  "formOpeningHoursLabel": "영업시간",
  "formOpeningHoursPlaceholder": "예: 09:00 - 22:00",
  "formLatitudeLabel": "위도",
  "formLongitudeLabel": "경도",
  "formCoordinatePlaceholder": "선택",
  "formMapUrlLabel": "카카오맵/후기 링크",
  "formReportNoteLabel": "제보 메모",
  "formSubmitLoadingText": "접수 중...",
  "addSubmitButton": "바로 등록하기",
  "editModalTitle": "{name} 정보 수정 요청",
  "editNameLabel": "식당명",
  "editCategoryLabel": "카테고리",
  "editMinPriceLabel": "최소 가격",
  "editMaxPriceLabel": "최대 가격",
  "editAddressLabel": "주소",
  "editKeywordSearchLabel": "카카오 장소 키워드 검색",
  "editKeywordPlaceholder": "예: 동남집 독산점, 가산디지털단지역 국밥",
  "editLatitudeLabel": "위도",
  "editLongitudeLabel": "경도",
  "editMainMenuLabel": "대표 메뉴",
  "editOpeningHoursLabel": "영업시간",
  "editMapUrlLabel": "카카오맵/후기 링크",
  "editSubmitLoadingText": "접수 중..."
};

const MEALMAP_STALE_TEXT_REPLACEMENTS = [
  {
    key: 'heroEyebrow',
    values: ['회식 장소 추천 지도'],
    nextValue: MEALMAP_DEFAULT_TEXTS.heroEyebrow,
  },
  {
    key: 'heroTitle',
    values: ['회식 장소를 지도에서 확인하고, 제보하고, 평가할 수 있습니다.'],
    nextValue: MEALMAP_DEFAULT_TEXTS.heroTitle,
  },
  {
    key: 'heroSubtitle',
    values: [
      '좋은 회식 장소를 제보하면 회식맵에 바로 공개됩니다.',
      '가격·카테고리·검색으로 후보를 좁히고, 제보된 장소는 관리자 승인 후 공개됩니다.',
      '가격·카테고리·검색으로 후보를 좁히고, 제보된 장소는 회식맵에 바로 공개됩니다.',
    ],
    nextValue: MEALMAP_DEFAULT_TEXTS.heroSubtitle,
  },
  {
    key: 'submitButton',
    values: ['+ 장소 제보하기'],
    nextValue: MEALMAP_DEFAULT_TEXTS.submitButton,
  },
  {
    key: 'mapGuideBody',
    values: ['네이버 API 키를 연결하기 전까지 목업 지도에서 기능 흐름을 확인할 수 있습니다.'],
    nextValue: MEALMAP_DEFAULT_TEXTS.mapGuideBody,
  },
  {
    key: 'addSubmitButton',
    values: ['관리자 승인 요청', '?? ????'],
    nextValue: MEALMAP_DEFAULT_TEXTS.addSubmitButton,
  },
  {
    key: 'naverButton',
    values: ['네이버지도/후기 보기', '네이버맵/후기 보기', '카카오맵/후기 보기', '????/?? ??'],
    nextValue: MEALMAP_DEFAULT_TEXTS.naverButton,
  },
];

async function refreshStaleMealMapDefaultTexts() {
  for (const item of MEALMAP_STALE_TEXT_REPLACEMENTS) {
    const placeholders = item.values.map(() => '?').join(', ');
    await pool.query(
      `UPDATE mealmap_page_texts
       SET text_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE text_key = ? AND text_value IN (${placeholders})`,
      [item.nextValue, 'system', item.key, ...item.values]
    );
  }

  // 이전 인코딩 문제로 system 기본 문구가 "??" 형태로 저장된 경우만 기본값으로 복구합니다.
  for (const [key, value] of Object.entries(MEALMAP_DEFAULT_TEXTS)) {
    await pool.query(
      `UPDATE mealmap_page_texts
       SET text_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE text_key = ?
         AND (updated_by = 'system' OR updated_by IS NULL)
         AND (text_value LIKE '%??%' OR text_value LIKE '%�%')`,
      [value, 'system', key]
    );
  }
}

async function ensureMealMapTextSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_page_texts (
      text_key VARCHAR(80) PRIMARY KEY,
      text_value TEXT NOT NULL,
      updated_by VARCHAR(80) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const [key, value] of Object.entries(MEALMAP_DEFAULT_TEXTS)) {
    await pool.query(
      'INSERT IGNORE INTO mealmap_page_texts (text_key, text_value, updated_by) VALUES (?, ?, ?)',
      [key, value, 'system']
    );
  }

  // 예전 기본 문구만 새 회식맵 정책 문구로 보정하고, 운영자가 직접 바꾼 고유 문구는 유지합니다.
  await refreshStaleMealMapDefaultTexts();
}

async function getMealMapTextMap() {
  await ensureMealMapTextSchema();
  const [rows] = await pool.query('SELECT text_key, text_value FROM mealmap_page_texts');
  const merged = { ...MEALMAP_DEFAULT_TEXTS };
  for (const row of rows || []) {
    const key = row.text_key || row.TEXT_KEY;
    const value = row.text_value || row.TEXT_VALUE;
    if (key && value !== undefined && value !== null) merged[key] = String(value);
  }
  return merged;
}

app.get('/api/mealmap/texts', async (req, res) => {
  try {
    const texts = await getMealMapTextMap();
    res.json({ success: true, texts });
  } catch (err) {
    console.error('[mealmap/texts] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 불러오지 못했습니다.' });
  }
});

app.get('/api/admin/mealmap/texts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin.ok || admin.valid)) return res.status(403).json({ success: false, msg: '관리자 권한이 필요합니다.' });

    const texts = await getMealMapTextMap();
    res.json({ success: true, texts, fields: Object.keys(MEALMAP_DEFAULT_TEXTS) });
  } catch (err) {
    console.error('[admin/mealmap/texts:get] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 불러오지 못했습니다.' });
  }
});

app.put('/api/admin/mealmap/texts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin.ok || admin.valid)) return res.status(403).json({ success: false, msg: '관리자 권한이 필요합니다.' });

    const bodyTexts = req.body?.texts || {};
    await ensureMealMapTextSchema();

    for (const key of Object.keys(MEALMAP_DEFAULT_TEXTS)) {
      const raw = bodyTexts[key];
      const value = String(raw === undefined || raw === null || String(raw).trim() === ''? MEALMAP_DEFAULT_TEXTS[key] : raw).trim();
      await pool.query(
        `INSERT INTO mealmap_page_texts (text_key, text_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE text_value = VALUES(text_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
        [key, value, admin.user?.username || admin.user?.user_id || admin.user?.id || 'admin']
      );
    }

    const texts = await getMealMapTextMap();
    res.json({ success: true, msg: '회식맵 문구 설정이 저장되었습니다.', texts });
  } catch (err) {
    console.error('[admin/mealmap/texts:put] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 저장하지 못했습니다.' });
  }
});
// ============================== //


}

module.exports = registerMealmapTextRoutes;
