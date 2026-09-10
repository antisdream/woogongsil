'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');
const { migrateLegacyCompatibility } = require('../migrations/legacyCompatibility');
function createSchemaCompatibilityChecker({ pool } = {}) {
    return { ensureSchemaCompatibility: () => runtimeSchemaGate(pool) || migrateLegacyCompatibility(pool) };
}
module.exports = { createSchemaCompatibilityChecker };
