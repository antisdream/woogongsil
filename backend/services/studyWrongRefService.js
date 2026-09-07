'use strict';

async function replaceStudyDocumentWrongRefs(pool, documentId, ownerId, refs) {
    if (!Array.isArray(refs)) return;
    await pool.query(`DELETE FROM wgs_study_document_wrong_refs WHERE documentId = ? AND ownerId = ?`, [documentId, ownerId]);
    const normalizedRefs = refs
        .map((ref) => ({
            sourceType: String(ref.sourceType || ref.source || '').trim().slice(0, 40),
            sourceId: String(ref.sourceId || ref.id || '').trim().slice(0, 80),
            sourcePayload: JSON.stringify(ref),
        }))
        .filter((ref) => ref.sourceType && ref.sourceId);

    if (normalizedRefs.length === 0) return;

    const placeholders = normalizedRefs.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const values = normalizedRefs.flatMap((ref) => [documentId, ownerId, ref.sourceType, ref.sourceId, ref.sourcePayload]);
    await pool.query(
        `INSERT INTO wgs_study_document_wrong_refs (documentId, ownerId, sourceType, sourceId, sourcePayload)
         VALUES ${placeholders}`,
        values
    );
}

module.exports = {
    replaceStudyDocumentWrongRefs,
};
