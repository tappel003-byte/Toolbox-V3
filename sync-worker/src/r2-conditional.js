/**
 * R2 conditional-write helpers for exclusive checkout leases.
 * Use object.etag (not httpEtag) for etagMatches.
 */

/**
 * @param {object|null|undefined} r2Object
 * @returns {string|null} usable ETag, or null if missing/unusable
 */
export function requireObjectEtag(r2Object) {
  if (!r2Object || typeof r2Object.etag !== 'string') return null;
  const etag = r2Object.etag.trim();
  return etag || null;
}

/**
 * Build put options that always include an ETag precondition.
 * Returns null when etag is missing — callers must refuse the write.
 *
 * @param {string|null|undefined} etag
 * @param {object} [httpMetadata]
 * @returns {{ httpMetadata: object, onlyIf: { etagMatches: string } }|null}
 */
export function conditionalPutOptions(etag, httpMetadata) {
  if (typeof etag !== 'string' || !etag.trim()) return null;
  return {
    httpMetadata: httpMetadata || { contentType: 'application/json' },
    onlyIf: { etagMatches: etag.trim() },
  };
}
