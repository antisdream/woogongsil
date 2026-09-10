'use strict';
const { runtimeLog: wgsRuntimeLog } = require("./runtimeLog");

const { runtimeSchemaGate } = require('./schemaRuntime');

function createAdminUserControlSchema({ pool, adminUserId = 'skn29' }) {
const ADMIN_USER_ID = adminUserId;
async function adminTableExists(tableName) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = ?`,
            [tableName]
        );
        return Number(rows?.[0]?.cnt || 0) >0;
    } catch (error) {
        wgsRuntimeLog("warn", "services/adminUserControlSchema.js:16", `관리자 테이블 존재 확인 실패(${tableName}):`, error.message);
        return false;
    }
}

async function adminColumnExists(tableName, columnName) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
            [tableName, columnName]
        );
        return Number(rows?.[0]?.cnt || 0) >0;
    } catch (error) {
        wgsRuntimeLog("warn", "services/adminUserControlSchema.js:31", `관리자 컬럼 존재 확인 실패(${tableName}.${columnName}):`, error.message);
        return false;
    }
}


let adminUserControlSchemaReady = false; // 사용자 제어 DB 구조를 1회 보정했는지 기억합니다.
let adminUserControlSchemaPromise = null; // 동시에 여러 요청이 들어와도 ALTER가 중복 실행되지 않도록 잠금 역할을 합니다.

async function ensureAdminUserControlSchema() {
    const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
    // 사용자 접속 제한, 운영자, 결재 기능용 컬럼과 테이블을 개발·배포 환경에서 안전하게 보정합니다.
    if (adminUserControlSchemaReady) return;
    if (adminUserControlSchemaPromise) return adminUserControlSchemaPromise;

    adminUserControlSchemaPromise = (async () => {
    if (!(await adminTableExists("wgs_users"))) return;

    const userColumns = [
        ["created_at", "DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '회원가입 일시'"],
        ["is_suspended", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '관리자 임시정지 여부'"],
        ["suspension_reason", "TEXT NULL COMMENT '임시정지 사유'"],
        ["suspended_at", "DATETIME NULL COMMENT '임시정지/해제 처리 일시'"],
        ["is_primary_admin", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '최고관리자 여부'"],
        ["is_operator", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '운영자 권한 여부'"],
        ["operator_reason", "TEXT NULL COMMENT '운영자 권한 변경 사유'"],
        ["operator_updated_at", "DATETIME NULL COMMENT '운영자 권한 변경 일시'"],
        ["operator_updated_by", "VARCHAR(100) NULL COMMENT '운영자 권한 변경 관리자'"],
        ["last_login_at", "DATETIME NULL COMMENT '최근 로그인 일시'"],
        ["last_logout_at", "DATETIME NULL COMMENT '최근 로그아웃 일시'"],
    ];

    for (const [columnName, definition] of userColumns) {
        if (!(await adminColumnExists("wgs_users", columnName))) {
            await pool.query(`ALTER TABLE wgs_users ADD COLUMN ${columnName} ${definition}`);
        }
    }

    const [primaryAdminRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_users WHERE COALESCE(is_primary_admin, 0) = 1');
    if (Number(primaryAdminRows?.[0]?.cnt || 0) === 0 && ADMIN_USER_ID) {
        await pool.query('UPDATE wgs_users SET is_primary_admin = 1 WHERE LOWER(id) = ?', [ADMIN_USER_ID]);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_approvals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            requester_id VARCHAR(100) NOT NULL,
            requester_name VARCHAR(100) NULL,
            action_method VARCHAR(20) NOT NULL,
            action_path TEXT NOT NULL,
            action_title VARCHAR(255) NULL,
            action_body LONGTEXT NULL,
            action_preview LONGTEXT NULL,
            status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
            requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_by VARCHAR(100) NULL,
            reviewed_at DATETIME NULL,
            reject_reason TEXT NULL,
            apply_result LONGTEXT NULL,
            hidden_from_primary TINYINT(1) NOT NULL DEFAULT 0,
            hidden_from_requester TINYINT(1) NOT NULL DEFAULT 0,
            INDEX idx_status_requested (status, requested_at),
            INDEX idx_requester_requested (requester_id, requested_at),
            INDEX idx_primary_hidden_requested (hidden_from_primary, requested_at),
            INDEX idx_requester_hidden_requested (hidden_from_requester, requester_id, requested_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 전체 공지 발송과 점검 모드 변경은 운영자가 바로 적용하므로 별도의 공통 이력 테이블에 저장합니다.
    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_operation_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            operation_type VARCHAR(40) NOT NULL,
            action VARCHAR(40) NOT NULL,
            title VARCHAR(200) NULL,
            message TEXT NULL,
            actor_id VARCHAR(80) NULL,
            actor_name VARCHAR(100) NULL,
            payload LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_admin_operation_type_created (operation_type, created_at),
            INDEX idx_admin_operation_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 같은 결재 DB 행을 공유하면서 최고관리자 목록과 운영자 본인 목록은 각각 숨김 처리합니다.
    // 실제 DELETE를 하지 않으므로 한쪽이 정리해도 다른 쪽의 확인/감사 목록에는 영향을 주지 않는다.
    const approvalVisibilityColumns = [
        ['hidden_from_primary', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '최고관리자 결재 목록 숨김 여부'"],
        ['hidden_from_requester', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '요청자 본인 결재 목록 숨김 여부'"],
    ];
    for (const [columnName, definition] of approvalVisibilityColumns) {
        if (!(await adminColumnExists('wgs_admin_approvals', columnName))) {
            await pool.query(`ALTER TABLE wgs_admin_approvals ADD COLUMN ${columnName} ${definition}`);
        }
    }

    adminUserControlSchemaReady = true;
    })();

    try {
        await adminUserControlSchemaPromise;
    } finally {
        adminUserControlSchemaPromise = null;
    }
}


return { ensureAdminUserControlSchema, adminTableExists, adminColumnExists };
}
module.exports = { createAdminUserControlSchema };
