// MySQL 연결 풀을 생성하고 공유합니다.
const mysql = require('mysql2/promise');

function createDatabasePool(env = process.env) {
    const pool = mysql.createPool({
        host: env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT || 3306),
        user: env.DB_USER || '',
        password: env.DB_PASSWORD || '',
        database: env.DB_NAME || 'exam_bank',
        waitForConnections: true,
        connectionLimit: Number(env.DB_CONNECTION_LIMIT || 10),
        charset: env.DB_CHARSET || 'utf8mb4',
        dateStrings: false,
    });

    if (typeof pool.promise !== 'function') {
        pool.promise = () => pool;
    }

    return pool;
}

module.exports = {
    createDatabasePool,
};
