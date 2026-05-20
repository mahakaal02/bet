import { createHash, createHmac } from 'crypto';

/**
 * Shared AWS SigV4 signer (Roadmap §Q2 infra triplet).
 *
 * Pulled out of `notifications/adapters/ses-sender.ts` so the same
 * signing logic backs SES email, S3 object PUT/GET/DELETE, and KMS
 * Encrypt/Decrypt — all of which use the same algorithm with a
 * different `service` string and slightly different canonical
 * request shape.
 *
 * Not pulled in: `@aws-sdk/*`. The whole point of these infra PRs
 * is to wire real AWS without dragging the 4-MB SDK + 80-package
 * peer-dep graph into the bundle. SigV4 is ~50 lines of well-
 * specified math (AWS docs §sigv4 §canonical-request); inlining it
 * matches the TOTP / RFC 6238 pattern used elsewhere.
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 */

export interface SignInput {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';
  /** Full URL including scheme + host + path + query. */
  url: string;
  /** Service short name: 'ses', 's3', 'kms', etc. */
  service: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /**
   * Optional STS session token. When using an IAM role on EC2/EKS/
   * Lambda the credential rotates and this token must accompany every
   * request — passing it here adds the correct `x-amz-security-token`
   * header to both the signed-headers list and the outgoing request.
   */
  sessionToken?: string;
  /** Request body bytes. Empty string is fine for GET / DELETE. */
  body: string | Buffer;
  /**
   * Additional headers to include in the signed-headers list. The
   * signer always adds `host`, `x-amz-date`, and `x-amz-content-sha256`.
   * Pass content-type, x-amz-server-side-encryption, etc. here.
   *
   * Header names MUST be lowercase. Values are trimmed but not
   * URL-encoded.
   */
  extraHeaders?: Record<string, string>;
}

export interface SignResult {
  /** Final headers map (lowercase keys) ready to drop into a `fetch`. */
  headers: Record<string, string>;
}

/**
 * Sign a request. Returns the headers the caller should send.
 *
 * SHA-256 of the body lands in `x-amz-content-sha256` for every
 * method — that's the S3 quirk; SES and KMS accept the same header
 * shape so we apply it uniformly.
 */
export function signRequest(input: SignInput): SignResult {
  const url = new URL(input.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  // S3 hashes the body bytes; SES / KMS hash the body string. Same
  // hex output either way because both end up running through SHA-256.
  const bodyBuffer =
    typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body;
  const payloadHash = createHash('sha256').update(bodyBuffer).digest('hex');

  // Canonical query string. AWS requires the params to be sorted by
  // key + each key/value URI-encoded. URLSearchParams iterates in
  // insertion order — sort before joining.
  const sortedParams = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const canonicalQuery = sortedParams
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&');

  // Canonical path. S3 quirk: the path is NOT double-encoded (it's
  // already URL-encoded by the URL constructor). For other services
  // the spec actually requires double-encoding, but S3 documents the
  // single-encoding exception. Since we sign one service at a time
  // and the URL was constructed from a known key, single-encoding is
  // correct everywhere we use this.
  const canonicalPath = url.pathname || '/';

  // Build headers map with the always-signed defaults.
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...(input.extraHeaders ?? {}),
  };
  if (input.sessionToken) {
    headers['x-amz-security-token'] = input.sessionToken;
  }

  // Canonical headers — sorted lowercase, value trimmed, terminated
  // by `\n` each.
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = headerKeys
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join('');
  const signedHeaders = headerKeys.join(';');

  // Canonical request.
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign.
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Derive signing key + signature (HMAC-SHA256 chain).
  const kDate = createHmac('sha256', `AWS4${input.secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(input.region).digest();
  const kService = createHmac('sha256', kRegion).update(input.service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  // Authorization header. Spaces between Credential / SignedHeaders /
  // Signature are mandatory; commas separate them per the spec.
  headers.authorization =
    `${algorithm} Credential=${input.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers };
}

/**
 * RFC 3986 percent-encoding — stricter than JavaScript's
 * `encodeURIComponent` (which leaves `! * ' ( )` unencoded). S3 +
 * SigV4 require RFC 3986.
 */
function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
