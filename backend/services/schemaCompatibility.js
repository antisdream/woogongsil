'use strict';

const { createSchemaScreenSettingDefaultRows } = require('./schemaScreenSettingsDefaults');

function createSchemaCompatibilityChecker({ pool } = {}) {
    if (!pool) throw new Error('createSchemaCompatibilityChecker requires mysql pool');

// 3. DB 스키마 호환성 보정
// - 핵심: 게시판 날짜는 DATETIME이 아니라 VARCHAR여야 기존 문자열이 안 깨져.
// - 핵심: noticeOrder 컬럼은 이미 있으면 ALTER ADD를 실행하지 않아
//  Duplicate column name 경고가 터미널에 반복 출력되지 않도록 처리합니다.
async function ensureSchemaCompatibility() {
    // 컬럼 존재 여부 확인 함수
    // - INFORMATION_SCHEMA를 조회해서 현재 접속 DB 안에 특정 컬럼이 있는지 확인합니다.
    // - 이렇게 확인한 뒤 ALTER ADD를 실행하면 Duplicate column name 경고를 없앨 수 있습니다.
    const columnExists = async (tableName, columnName) => {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            `,
            [tableName, columnName]
        );

        return Number(rows?.[0]?.cnt || 0) >0;
    };

    // 기존 문자열 날짜 데이터 보호
    // - 기존 게시판/댓글/대댓글 날짜가 문자열 포맷으로 들어가 있으므로 VARCHAR로 유지합니다.
    // - 이미 VARCHAR인 경우에도 MODIFY는 안전하게 통과합니다.
    const modifyQueries = [
        'ALTER TABLE wgs_posts MODIFY COLUMN date VARCHAR(50) DEFAULT NULL',
        'ALTER TABLE wgs_comments MODIFY COLUMN date VARCHAR(50) DEFAULT NULL',
        'ALTER TABLE wgs_replies MODIFY COLUMN date VARCHAR(50) DEFAULT NULL'
    ];

    for (const query of modifyQueries) {
        try {
            await pool.query(query);
        } catch (error) {
            console.warn('스키마 보정 건너뜀:', error.message);
        }
    }

    // 공지 수동 정렬용 컬럼 보정
    // - 이미 noticeOrder가 있으면 아무 작업도 하지 않습니다.
    // - 없을 때만 ALTER TABLE ADD COLUMN을 실행합니다.
    try {
        const hasNoticeOrder = await columnExists('wgs_posts', 'noticeOrder');

        if (!hasNoticeOrder) {
            await pool.query('ALTER TABLE wgs_posts ADD COLUMN noticeOrder INT DEFAULT NULL');
            console.log('OK: wgs_posts.noticeOrder column added');
        } else {
            console.log('OK: wgs_posts.noticeOrder column exists');
        }
    } catch (error) {
        console.warn('noticeOrder 컬럼 보정 건너뜀:', error.message);
    }

    // BlockNote 에디터 원본 JSON 저장용 컬럼 보정
    // - 기존 content 컬럼은 검색/게시판 구분/구버전 표시 호환을 위해 그대로 유지합니다.
    // - contentJson은 새 에디터 문서 구조만 추가로 보관하므로 기존 게시글 데이터는 변경하지 않습니다.
    try {
        const hasContentJson = await columnExists('wgs_posts', 'contentJson');

        if (!hasContentJson) {
            await pool.query('ALTER TABLE wgs_posts ADD COLUMN contentJson LONGTEXT NULL');
            console.log('OK: wgs_posts.contentJson column added');
        } else {
            console.log('OK: wgs_posts.contentJson column exists');
        }
    } catch (error) {
        console.warn('contentJson 컬럼 보정 건너뜀:', error.message);
    }

    // 기존 공지 중 noticeOrder가 비어 있는 데이터에 기본 순서를 채웁니다.
    // - 관리자가 직접 공지 순서를 저장하기 전까지는 최신 공지가 위에 오도록 id 기준으로 부여합니다.
    // - 이미 순서가 저장된 공지는 변경하지 않으므로 관리자 정렬값이 갱신되지 않습니다.
    try {
        const [noticeRows] = await pool.query(
            'SELECT id FROM wgs_posts WHERE isNotice = 1 AND noticeOrder IS NULL ORDER BY CAST(id AS UNSIGNED) DESC, id DESC'
        );

        for (let i = 0; i < noticeRows.length; i += 1) {
            await pool.query('UPDATE wgs_posts SET noticeOrder = ? WHERE id = ?', [i + 1, noticeRows[i].id]);
        }

        console.log('OK: wgs_posts.noticeOrder default order checked');
    } catch (error) {
        console.warn('공지 순서 기본값 보정 건너뜀:', error.message);
    }

    //  화면 설정 관리 테이블 보정
    // - 기존 기능 DB 구조를 변경하지 않고 관리자 화면 설정 CRUD 전용 테이블만 추가합니다.
    // - CREATE TABLE IF NOT EXISTS 방식이라 환경별 어디서 실행해도 반복 실행이 안전합니다.
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_screen_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_key VARCHAR(50) NOT NULL,
                section_key VARCHAR(80) NOT NULL DEFAULT 'common',
                setting_type VARCHAR(30) NOT NULL DEFAULT 'text',
                setting_key VARCHAR(100) NOT NULL,
                setting_label VARCHAR(150) NOT NULL,
                setting_value TEXT NULL,
                description TEXT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by VARCHAR(50) NULL,
                updated_by VARCHAR(50) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_wgs_screen_page (page_key),
                INDEX idx_wgs_screen_type (setting_type),
                INDEX idx_wgs_screen_active (is_active),
                UNIQUE KEY uk_wgs_screen_setting (page_key, section_key, setting_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`INSERT IGNORE INTO wgs_screen_settings
                (page_key, section_key, setting_type, setting_key, setting_label, setting_value, description, sort_order, created_by, updated_by)
            VALUES
                ('all', 'global', 'text', 'site_title', '전체 사이트명', 'SKN_우공실', '헤더와 공통 영역에서 사용할 수 있는 사이트명입니다.', 1, 'system', 'system'),
                ('home', 'hero', 'text', 'hero_title', '홈 메인 제목', 'SKN_우공실', '홈 화면 메인 영역에 사용할 제목 문구입니다.', 10, 'system', 'system'),
                ('home', 'hero', 'text', 'hero_desc', '홈 메인 설명 문구', '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.', '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.', 20, 'system', 'system'),
                ('exam', 'layout', 'layout', 'question_card_width', '문제 카드 너비', '100%', '시험/연습 화면 문제 카드의 기본 너비 값입니다.', 30, 'system', 'system'),
                ('admin', 'theme', 'color', 'accent_color', '관리자 강조 색상', '#38bdf8', '관리자 화면에서 참고할 강조 색상 값입니다.', 40, 'system', 'system'),
                ('all', 'image', 'image', 'default_banner', '공통 배너 이미지 경로', '', '각 페이지에서 공통으로 사용할 수 있는 배너 이미지 URL 또는 public 기준 경로입니다.', 50, 'system', 'system')
        `);

        // 홈 상단 설명 문구는 관리자 > 화면 설정 관리에서 관리합니다.
        // 예전 기본 문장만 자동 갱신하고, 관리자가 직접 수정한 문구는 유지합니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET setting_value = ?,
                    setting_label = ?,
                    description = ?,
                    updated_by = 'system' WHERE page_key = 'home' AND section_key = 'hero' AND setting_key = 'hero_desc' AND setting_value IN (?, ?, ?, ?)`,
            [
                '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.',
                '홈 메인 설명 문구',
                '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.',
                '정보처리기사 필기/실기 문제를 연습하고 오답을 관리합니다.',
                '정보처리기사 필기/실기 문제를 연습하고 모험을 떠나보세요.',
                '정보처리기사 필기/실기 문제를 연습하고 오답 관리를 할 수 있습니다.',
                '정보처리기사 필기/실기 문제를 연습하고 오답을 관리합니다'
            ]
        );

        // 값이 이미 수정되었더라도 관리자 라벨과 도움말 문구는 일관되게 유지합니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET setting_label = ?,
                    description = ?
              WHERE page_key = 'home' AND section_key = 'hero' AND setting_key = 'hero_desc'`,
            ['홈 메인 설명 문구', '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.']
        );


        // 홈 화면에 보이는 문구/링크 기본값을 관리자 화면 설정 DB에 안전하게 등록합니다.
        // - page_key='home', section_key + setting_key 조합으로 저장해 useScreenSettings('home')의 getSetting('section.key')와 맞춥니다.
        // - INSERT IGNORE를 사용해 기존 관리자가 수정한 setting_value는 갱신하지 않습니다.
        // - 이후 UPDATE는 관리자 목록에서 보이는 이름/설명/정렬만 보정하고 실제 문구값은 유지합니다.
        const {
            homeScreenDefaultRowsFix18V9,
            screenSettingDefaultsNoHardcodeV1
        } = createSchemaScreenSettingDefaultRows();

        for (const [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder] of homeScreenDefaultRowsFix18V9) {
            await pool.query(
                `INSERT IGNORE INTO wgs_screen_settings
                    (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                     description, sort_order, is_active, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'system', 'system')`,
                [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder]
            );

            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_type = ?, setting_label = ?, description = ?, sort_order = ?, is_active = 1, updated_by = 'system' WHERE page_key = ? AND section_key = ? AND setting_key = ?`,
                [settingType, settingLabel, description, sortOrder, pageKey, sectionKey, settingKey]
            );
        }

        const homeQuickLinkUrlFixRows = [
            ['notion_button_url', 'https://app.notion.com/p/SKN-29th-328031734e3e805ba1a8d60026dcaf94?source=copy_link'],
            ['developer_button_url', 'https://blog.naver.com/andisdream'],
        ];

        for (const [settingKey, settingValue] of homeQuickLinkUrlFixRows) {
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_value = ?,
                        updated_by = 'system'
                  WHERE page_key = 'home'
                    AND section_key = 'quick_links'
                    AND setting_key = ?
                    AND (setting_value IS NULL OR TRIM(setting_value) = '' OR TRIM(setting_value) = '#')`,
                [settingValue, settingKey]
            );
        }

        const currentSiteTitle = 'SKN_우공실';
        const legacySiteTitle = ['SKN', '29th'].join('') + '_우공실';
        const siteTitleRenameRows = [
            ['all', 'global', 'site_title'],
            ['home', 'hero', 'hero_title'],
        ];

        for (const [pageKey, sectionKey, settingKey] of siteTitleRenameRows) {
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_value = ?,
                        updated_by = 'system'
                  WHERE page_key = ?
                    AND section_key = ?
                    AND setting_key = ?
                    AND setting_value = ?`,
                [currentSiteTitle, pageKey, sectionKey, settingKey, legacySiteTitle]
            );
        }

        // 화면 하드코딩 제거용 기본 설정입니다.
        // 기존 테이블과 키 연결을 유지하고 INSERT IGNORE로 관리자 수정값은 덮어쓰지 않습니다.
        for (const [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder] of screenSettingDefaultsNoHardcodeV1) {
            await pool.query(
                `INSERT IGNORE INTO wgs_screen_settings
                    (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                     description, sort_order, is_active, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'system', 'system')`,
                [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder]
            );

            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_type = ?, setting_label = ?, description = ?, sort_order = ?, is_active = 1, updated_by = 'system'
                  WHERE page_key = ? AND section_key = ? AND setting_key = ?`,
                [settingType, settingLabel, description, sortOrder, pageKey, sectionKey, settingKey]
            );
        }

        // Public-facing home defaults no longer use decorative emoji.
        // Existing admin-edited values are preserved; only the previous built-in defaults are cleaned.
        const homeScreenEmojiCleanupRows = [
            ['quick_links', 'exam_button_label', '\u{1F4DD} 시험 접수', '시험 접수'],
            ['quick_links', 'notion_button_label', '\u{1F4D3} Notion', 'Notion'],
            ['quick_links', 'developer_button_label', '\u{1F9D1}\u200D\u{1F4BB} 개발자', '개발자'],
            ['quick_links', 'mobile_button_label', '\u{1F4F1} 모바일', '모바일'],
            ['hero', 'welcome_prefix', '\u{1F389}', ''],
            ['hero', 'dday_prefix', '\u{1F525} 시험일까지', '시험일까지'],
            ['hero', 'today_class_prefix', '\u{1F4C5} 오늘은', '오늘은'],
            ['mobile_qr', 'title', '\u{1F4F1} 모바일에서 접속하기', '모바일에서 접속하기'],
            ['score_ranking', 'section_title', '\u{1F3C6} 나의 점수는?', '나의 점수는?'],
            ['score_ranking', 'year_select_title', '\u{1F4C5} 연도 선택', '연도 선택'],
            ['score_ranking', 'session_select_title', '\u{1F4DD} 회차 선택', '회차 선택'],
            ['score_ranking', 'top_title_prefix', '\u{1F525} 오늘의', '오늘의'],
            ['score_ranking', 'season_text', '\u{1F4C5} 24시간 랭킹 (00:00 ~ 23:59)', '24시간 랭킹 (00:00 ~ 23:59)'],
            ['score_ranking', 'my_ranking_title', '\u{1F464} 나의 실시간 랭킹', '나의 실시간 랭킹'],
            ['ranking_history', 'metric_score_label', '\u25A0 점수', '점수'],
            ['ranking_history', 'metric_accuracy_label', '\u25CF 정답률', '정답률'],
        ];

        for (const [sectionKey, settingKey, oldValue, newValue] of homeScreenEmojiCleanupRows) {
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_value = ?,
                        updated_by = 'system' WHERE page_key = 'home' AND section_key = ?
                    AND setting_key = ?
                    AND setting_value = ?`,
                [newValue, sectionKey, settingKey, oldValue]
            );
        }


        // 이전 v8 패치에서 page_key='home' / section_key='copy'로 등록했던 세부 문구는
        // 실제 화면에서는 hero/live_chat/score_ranking 섹션으로 이관했습니다.
        // 기존 DB 값은 삭제하지 않고 비활성화만 하여 관리자 목록이 헷갈리지 않도록 정리합니다.
        const legacyHomeCopyKeysFix18Cleanup = [
            'welcome_prefix', 'welcome_suffix', 'dday_prefix', 'dday_suffix',
            'today_class_prefix', 'today_class_suffix',
            'current_visitor_prefix', 'current_visitor_suffix', 'refresh_loading_label',
            'request_time_label', 'me_label', 'recent_activity_label', 'just_now_label',
            'accuracy_label', 'rank_suffix', 'score_suffix', 'no_personal_ranking_message'
        ];

        if (legacyHomeCopyKeysFix18Cleanup.length >0) {
            const legacyPlaceholders = legacyHomeCopyKeysFix18Cleanup.map(() => '?').join(', ');
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET is_active = 0,
                        description = 'Legacy home copy setting hidden because the Home page now uses section-based screen settings.',
                        updated_by = 'system' WHERE page_key = 'home' AND section_key = 'copy' AND setting_key IN (${legacyPlaceholders})`,
                legacyHomeCopyKeysFix18Cleanup
            );
        }


        // 일부 이전 행은 home.copy.* 형태의 setting_key로 저장되어 있었습니다.
        // 현재 홈 화면은 섹션 기반 키를 사용하므로 이 행들은 이전 중복 데이터입니다.
        // 예: hero.*, live_chat.*, score_ranking.*, ranking_history.*, calendar.*
        // 행은 백업 데이터로 보존하되 기본 활성 관리자 목록에서는 숨깁니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET is_active = 0,
                    description = 'Legacy home.copy.* setting preserved as an inactive backup row.',
                    updated_by = 'system' WHERE page_key = 'home' AND section_key = 'copy' AND setting_key LIKE 'home.copy.%'`
        );

        console.log('OK: wgs_screen_settings table checked');
    } catch (error) {
        console.warn('Screen settings schema check skipped:', error.message);
    }
}


    return {
        ensureSchemaCompatibility
    };
}

module.exports = {
    createSchemaCompatibilityChecker
};
