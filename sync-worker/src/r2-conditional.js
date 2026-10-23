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
 * Build put options that create the object ONLY if it does not exist.
 *
 * R2 documents If-None-Match: * as atomic create-once: two requests racing to
 * create the same absent key cannot both succeed. The Workers binding takes it
 * as a Headers object, and a failed conditional put returns null WITHOUT
 * storing anything -- it does not throw, and it is not the S3 API's HTTP 412.
 *
 * https://developers.cloudflare.com/r2/reference/consistency/
 * https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 *
 * @param {object} [httpMetadata]
 */
export function createOnlyPutOptions(httpMetadata) {
  return {
    httpMetadata: httpMetadata || { contentType: 'application/json' },
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  };
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
