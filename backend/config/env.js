// 환경변수와 운영 기본값을 정리합니다.
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath = path.join(__dirname, '..', '.env')) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) continue;

        const equalIndex = line.indexOf('=');
        if (equalIndex === -1) continue;

        const key = line.slice(0, equalIndex).trim();
        let value = line.slice(equalIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) process.env[key] = value;
    }
}

module.exports = {
    loadEnvFile,
};
