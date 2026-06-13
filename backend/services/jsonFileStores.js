const fs = require('fs');
const path = require('path');

function createJsonFileStores(baseDir) {
    const USER_FILE = path.join(baseDir, 'users_data.json');
    const POSTS_FILE = path.join(baseDir, 'posts_data.json');
    const RANKING_RANDOM_FILE = path.join(baseDir, 'ranking_random.json');
    const RANKING_PAST_FILE = path.join(baseDir, 'ranking_past.json');
    const RANKING_DATA_FILE = path.join(baseDir, 'ranking_data.json');
    const IPEP_RANKING_FILE = path.join(baseDir, 'ipep_rankings.json');
    const IPEP_WRONG_FILE = path.join(baseDir, 'ipep_wrong_notes.json');

    function readJSON(filePath, fallback) {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw.trim()) return fallback;
            return JSON.parse(raw);
        } catch (error) {
            console.error(`JSON read failed: ${path.basename(filePath)}`, error.message);
            return fallback;
        }
    }

    function writeJSON(filePath, data) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    function readObjectJSON(filePath, defaultValue) {
        const value = readJSON(filePath, defaultValue);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : defaultValue;
    }

    function getIpepRankingStore() {
        const store = readObjectJSON(IPEP_RANKING_FILE, { random: [], past: [] });
        return {
            random: Array.isArray(store.random) ? store.random : [],
            past: Array.isArray(store.past) ? store.past : [],
        };
    }

    function saveIpepRankingStore(store) {
        writeJSON(IPEP_RANKING_FILE, {
            random: Array.isArray(store.random) ? store.random : [],
            past: Array.isArray(store.past) ? store.past : [],
        });
    }

    function getIpepWrongStore() {
        return readObjectJSON(IPEP_WRONG_FILE, {});
    }

    function saveIpepWrongStore(store) {
        writeJSON(IPEP_WRONG_FILE, store && typeof store === 'object' ? store : {});
    }

    return {
        USER_FILE,
        POSTS_FILE,
        RANKING_RANDOM_FILE,
        RANKING_PAST_FILE,
        RANKING_DATA_FILE,
        IPEP_RANKING_FILE,
        IPEP_WRONG_FILE,
        readJSON,
        writeJSON,
        readObjectJSON,
        getIpepRankingStore,
        saveIpepRankingStore,
        getIpepWrongStore,
        saveIpepWrongStore,
    };
}

module.exports = {
    createJsonFileStores,
};
