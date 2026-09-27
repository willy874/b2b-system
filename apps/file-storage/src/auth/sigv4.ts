import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import type { Query } from '@/http/target';
import { S3Error } from '@/s3/errors';

/**
 * AWS Signature Version 4 的驗證端。
 * 規格：https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html
 *
 * 支援兩種帶簽章的方式：
 * - `Authorization` 標頭（SDK 一般呼叫）
 * - 查詢參數（presigned URL）
 *
 * 不驗 region：credential scope 裡寫什麼 region 就拿什麼算簽章，
 * 客戶端設定成哪個 region 都能連（模擬器只有一個「region」）。
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const TERMINATOR = 'aws4_request';
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;
const MAX_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_SHA256 = createHash('sha256').digest('hex');

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignedRequest {
  method: string;
  rawPath: string;
  query: Query;
  headers: IncomingHttpHeaders;
}

/** 驗證通過後，body 要怎麼讀（決定是否要解 aws-chunked、是否要驗 SHA-256）。 */
export type PayloadMode =
  | { kind: 'unsigned' }
  | { kind: 'sha256'; hash: string }
  | { kind: 'aws-chunked' };

interface CredentialScope {
  accessKeyId: string;
  date: string;
  region: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** RFC 3986 unreserved 以外的字元一律 %XX（大寫），這是 SigV4 對「URI encode」的定義。 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** S3 的 canonical URI 只編碼一次：把路徑逐段解碼再用 SigV4 的規則重新編碼。 */
export function canonicalUri(rawPath: string): string {
  return rawPath
    .split('/')
    .map((segment) => {
      try {
        return uriEncode(decodeURIComponent(segment));
      } catch {
        throw new S3Error('InvalidURI');
      }
    })
    .join('/');
}

export function canonicalQueryString(query: Query, exclude?: string): string {
  return query.entries
    .filter(([key]) => key !== exclude)
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .toSorted(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? (valueA < valueB ? -1 : 1) : keyA < keyB ? -1 : 1,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  const joined = Array.isArray(value) ? value.join(',') : (value ?? '');
  return joined.trim().replace(/\s+/g, ' ');
}

export function canonicalRequest(
  request: SignedRequest,
  signedHeaders: readonly string[],
  payloadHash: string,
  excludeQuery?: string,
): string {
  return [
    request.method,
    canonicalUri(request.rawPath),
    canonicalQueryString(request.query, excludeQuery),
    signedHeaders.map((name) => `${name}:${headerValue(request.headers, name)}\n`).join(''),
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
}

export function signingKey(secretAccessKey: string, scope: CredentialScope): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, scope.date);
  const regionKey = hmac(dateKey, scope.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, TERMINATOR);
}

export function stringToSign(amzDate: string, scope: CredentialScope, canonical: string): string {
  return [
    ALGORITHM,
    amzDate,
    `${scope.date}/${scope.region}/${SERVICE}/${TERMINATOR}`,
    sha256Hex(canonical),
  ].join('\n');
}

function parseAmzDate(amzDate: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second);
}

function parseCredential(
  credential: string,
  credentials: Credentials,
  onMalformed: () => S3Error,
): CredentialScope {
  const parts = credential.split('/');
  if (parts.length !== 5) throw onMalformed();
  const [accessKeyId, date, region, service, terminator] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (service !== SERVICE || terminator !== TERMINATOR || !/^\d{8}$/.test(date)) {
    throw onMalformed();
  }
  if (accessKeyId !== credentials.accessKeyId) throw new S3Error('InvalidAccessKeyId');
  return { accessKeyId, date, region };
}

function assertSignature(
  request: SignedRequest,
  credentials: Credentials,
  scope: CredentialScope,
  amzDate: string,
  canonical: string,
  provided: string,
): void {
  const toSign = stringToSign(amzDate, scope, canonical);
  const expected = createHmac('sha256', signingKey(credentials.secretAccessKey, scope))
    .update(toSign, 'utf8')
    .digest();
  const actual = Buffer.from(provided, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new S3Error('SignatureDoesNotMatch', undefined, {
      AWSAccessKeyId: scope.accessKeyId,
      StringToSign: toSign,
      CanonicalRequest: canonical,
      RequestPath: request.rawPath,
    });
  }
}

function parseAuthorizationHeader(header: string): {
  credential: string;
  signedHeaders: string[];
  signature: string;
} {
  if (!header.startsWith(`${ALGORITHM} `)) {
    throw new S3Error('InvalidArgument', 'Only AWS4-HMAC-SHA256 is supported.');
  }
  const fields = new Map(
    header
      .slice(ALGORITHM.length + 1)
      .split(',')
      .map((field) => field.trim())
      .map((field) => {
        const separator = field.indexOf('=');
        return [field.slice(0, separator), field.slice(separator + 1)] as const;
      }),
  );
  const credential = fields.get('Credential');
  const signedHeaders = fields.get('SignedHeaders');
  const signature = fields.get('Signature');
  if (!credential || !signedHeaders || !signature) {
    throw new S3Error('AuthorizationHeaderMalformed');
  }
  return { credential, signedHeaders: signedHeaders.split(';'), signature };
}

function payloadModeOf(hash: string): PayloadMode {
  if (hash === UNSIGNED_PAYLOAD) return { kind: 'unsigned' };
  // STREAMING-UNSIGNED-PAYLOAD-TRAILER、STREAMING-AWS4-HMAC-SHA256-PAYLOAD(-TRAILER) 等：
  // body 是 aws-chunked 編碼。逐塊簽章（chunk-signature）不再另外驗，見 docs/architecture/03-file-storage.md §5
  if (hash.startsWith('STREAMING-')) return { kind: 'aws-chunked' };
  if (/^[0-9a-f]{64}$/.test(hash)) return { kind: 'sha256', hash };
  throw new S3Error(
    'InvalidArgument',
    'x-amz-content-sha256 must be UNSIGNED-PAYLOAD, STREAMING-* or a SHA-256 hex digest.',
  );
}

function verifyHeaderAuth(
  request: SignedRequest,
  credentials: Credentials,
  authorization: string,
  now: number,
): PayloadMode {
  const { credential, signedHeaders, signature } = parseAuthorizationHeader(authorization);
  const scope = parseCredential(
    credential,
    credentials,
    () => new S3Error('AuthorizationHeaderMalformed'),
  );

  const amzDate = headerValue(request.headers, 'x-amz-date');
  const signedAt = parseAmzDate(amzDate);
  if (Number.isNaN(signedAt) || amzDate.slice(0, 8) !== scope.date) {
    throw new S3Error('AccessDenied', 'AWS authentication requires a valid x-amz-date header.');
  }
  if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) throw new S3Error('RequestTimeTooSkewed');
  if (!signedHeaders.includes('host')) throw new S3Error('AuthorizationHeaderMalformed');

  const payloadHash = headerValue(request.headers, 'x-amz-content-sha256');
  if (payloadHash === '') {
    throw new S3Error(
      'InvalidRequest',
      'Missing required header for this request: x-amz-content-sha256',
    );
  }
  const mode = payloadModeOf(payloadHash);

  const canonical = canonicalRequest(request, signedHeaders, payloadHash);
  assertSignature(request, credentials, scope, amzDate, canonical, signature);
  return mode;
}

function malformedQueryAuth(): S3Error {
  return new S3Error('AuthorizationQueryParametersError');
}

function verifyQueryAuth(
  request: SignedRequest,
  credentials: Credentials,
  now: number,
): PayloadMode {
  const { query } = request;
  if (query.get('X-Amz-Algorithm') !== ALGORITHM) throw malformedQueryAuth();

  const credential = query.get('X-Amz-Credential');
  const amzDate = query.get('X-Amz-Date') ?? '';
  const expires = Number(query.get('X-Amz-Expires'));
  const signedHeaders = query.get('X-Amz-SignedHeaders');
  const signature = query.get('X-Amz-Signature');
  if (!credential || !signedHeaders || !signature) throw malformedQueryAuth();
  if (!Number.isInteger(expires) || expires < 1 || expires > MAX_PRESIGN_EXPIRES_SECONDS) {
    throw new S3Error(
      'AuthorizationQueryParametersError',
      'X-Amz-Expires must be between 1 and 604800 seconds.',
    );
  }

  const scope = parseCredential(credential, credentials, malformedQueryAuth);
  const signedAt = parseAmzDate(amzDate);
  if (Number.isNaN(signedAt) || amzDate.slice(0, 8) !== scope.date) throw malformedQueryAuth();
  if (signedAt - now > MAX_CLOCK_SKEW_MS) {
    throw new S3Error('AccessDenied', 'Request is not valid yet');
  }
  if (now > signedAt + expires * 1000) throw new S3Error('AccessDenied', 'Request has expired');

  const headerList = signedHeaders.split(';');
  if (!headerList.includes('host')) throw malformedQueryAuth();

  const payloadHash = query.get('X-Amz-Content-Sha256') ?? UNSIGNED_PAYLOAD;
  const canonical = canonicalRequest(request, headerList, payloadHash, 'X-Amz-Signature');
  assertSignature(request, credentials, scope, amzDate, canonical, signature);
  return payloadModeOf(payloadHash);
}

/**
 * 驗證請求的 SigV4 簽章；失敗時拋出與 S3 相同錯誤碼的 `S3Error`。
 * 不接受匿名請求——所有物件都是私有的，要公開讀取請發 presigned URL。
 */
export function authenticate(
  request: SignedRequest,
  credentials: Credentials,
  now: number = Date.now(),
): PayloadMode {
  const authorization = headerValue(request.headers, 'authorization');
  if (authorization !== '') return verifyHeaderAuth(request, credentials, authorization, now);
  if (request.query.has('X-Amz-Signature')) return verifyQueryAuth(request, credentials, now);
  throw new S3Error('AccessDenied');
}
