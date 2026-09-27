import { authenticate, canonicalUri, EMPTY_SHA256, uriEncode } from '@/auth/sigv4';
import { parseTarget } from '@/http/target';
import { S3Error } from '@/s3/errors';

/**
 * AWS 官方文件的範例（Signature Calculations for the Authorization Header / Query String）：
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const SIGNED_AT = Date.UTC(2013, 4, 24, 0, 0, 0);

function request(url: string, headers: Record<string, string>) {
  const target = parseTarget(url);
  return { method: 'GET', rawPath: target.rawPath, query: target.query, headers };
}

function captureError(run: () => unknown): S3Error {
  try {
    run();
  } catch (error) {
    if (error instanceof S3Error) return error;
    throw error;
  }
  throw new Error('預期要拋出 S3Error');
}

describe('authenticate（Authorization 標頭）', () => {
  const headers = {
    host: 'examplebucket.s3.amazonaws.com',
    range: 'bytes=0-9',
    'x-amz-content-sha256': EMPTY_SHA256,
    'x-amz-date': '20130524T000000Z',
    authorization:
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  };

  it('AWS 文件的 GET Object 範例驗證通過', () => {
    expect(authenticate(request('/test.txt', headers), credentials, SIGNED_AT)).toEqual({
      kind: 'sha256',
      hash: EMPTY_SHA256,
    });
  });

  it('簽過的標頭被改動回 SignatureDoesNotMatch', () => {
    const error = captureError(() =>
      authenticate(
        request('/test.txt', { ...headers, range: 'bytes=0-10' }),
        credentials,
        SIGNED_AT,
      ),
    );
    expect(error.code).toBe('SignatureDoesNotMatch');
  });

  it('時間差超過 15 分鐘回 RequestTimeTooSkewed', () => {
    const error = captureError(() =>
      authenticate(request('/test.txt', headers), credentials, SIGNED_AT + 16 * 60 * 1000),
    );
    expect(error.code).toBe('RequestTimeTooSkewed');
  });

  it('缺少 x-amz-content-sha256 回 InvalidRequest', () => {
    const { 'x-amz-content-sha256': _omitted, ...rest } = headers;
    const error = captureError(() =>
      authenticate(request('/test.txt', rest), credentials, SIGNED_AT),
    );
    expect(error.code).toBe('InvalidRequest');
  });

  it('沒有任何簽章回 AccessDenied', () => {
    const error = captureError(() =>
      authenticate(request('/test.txt', { host: 'x' }), credentials, SIGNED_AT),
    );
    expect(error.code).toBe('AccessDenied');
  });
});

describe('authenticate（presigned URL）', () => {
  const url =
    '/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
  const headers = { host: 'examplebucket.s3.amazonaws.com' };

  it('AWS 文件的 presigned GET 範例驗證通過', () => {
    expect(authenticate(request(url, headers), credentials, SIGNED_AT + 1000)).toEqual({
      kind: 'unsigned',
    });
  });

  it('過期回 AccessDenied', () => {
    const error = captureError(() =>
      authenticate(request(url, headers), credentials, SIGNED_AT + 86_401 * 1000),
    );
    expect(error.code).toBe('AccessDenied');
    expect(error.message).toBe('Request has expired');
  });

  it('X-Amz-Expires 超過 7 天回 AuthorizationQueryParametersError', () => {
    const error = captureError(() =>
      authenticate(
        request(url.replace('X-Amz-Expires=86400', 'X-Amz-Expires=604801'), headers),
        credentials,
        SIGNED_AT,
      ),
    );
    expect(error.code).toBe('AuthorizationQueryParametersError');
  });
});

describe('uriEncode / canonicalUri', () => {
  it.each([
    ['a b', 'a%20b'],
    ['a+b', 'a%2Bb'],
    ["!'()*", '%21%27%28%29%2A'],
    ['-_.~', '-_.~'],
    ['中', '%E4%B8%AD'],
  ])('uriEncode(%s) = %s', (input, expected) => {
    expect(uriEncode(input)).toBe(expected);
  });

  it('路徑逐段正規化，斜線保留', () => {
    expect(canonicalUri('/bucket/a%20b/c+d/%E4%B8%AD')).toBe('/bucket/a%20b/c%2Bd/%E4%B8%AD');
  });
});
