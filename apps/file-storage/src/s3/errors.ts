/**
 * S3 的錯誤碼與對應的 HTTP 狀態碼。
 * 名稱、狀態碼與預設訊息都照 AWS 的
 * [Error responses](https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html) 列表，
 * 讓 AWS SDK 能把回應還原成同名的例外（例：`NoSuchKey`）。
 */
export const S3_ERRORS = {
  AccessDenied: { status: 403, message: 'Access Denied' },
  AuthorizationHeaderMalformed: {
    status: 400,
    message: 'The authorization header you provided is invalid.',
  },
  AuthorizationQueryParametersError: {
    status: 400,
    message: 'Query-string authentication parameters are invalid.',
  },
  BadDigest: {
    status: 400,
    message: 'The Content-MD5 you specified did not match what we received.',
  },
  BucketAlreadyOwnedByYou: {
    status: 409,
    message: 'Your previous request to create the named bucket succeeded and you already own it.',
  },
  BucketNotEmpty: { status: 409, message: 'The bucket you tried to delete is not empty.' },
  EntityTooLarge: {
    status: 400,
    message: 'Your proposed upload exceeds the maximum allowed object size.',
  },
  EntityTooSmall: {
    status: 400,
    message: 'Your proposed upload is smaller than the minimum allowed object size.',
  },
  IncompleteBody: {
    status: 400,
    message: 'You did not provide the number of bytes specified by the Content-Length HTTP header.',
  },
  InternalError: {
    status: 500,
    message: 'We encountered an internal error. Please try again.',
  },
  InvalidAccessKeyId: {
    status: 403,
    message: 'The AWS access key ID you provided does not exist in our records.',
  },
  InvalidArgument: { status: 400, message: 'Invalid Argument' },
  InvalidBucketName: { status: 400, message: 'The specified bucket is not valid.' },
  InvalidDigest: { status: 400, message: 'The Content-MD5 you specified is not valid.' },
  InvalidPart: {
    status: 400,
    message:
      "One or more of the specified parts could not be found. The part might not have been uploaded, or the specified entity tag might not have matched the part's entity tag.",
  },
  InvalidPartOrder: {
    status: 400,
    message: 'The list of parts was not in ascending order. Parts must be ordered by part number.',
  },
  InvalidRange: { status: 416, message: 'The requested range is not satisfiable' },
  InvalidRequest: { status: 400, message: 'Invalid Request' },
  InvalidURI: { status: 400, message: "Couldn't parse the specified URI." },
  KeyTooLongError: { status: 400, message: 'Your key is too long.' },
  MalformedXML: {
    status: 400,
    message:
      'The XML you provided was not well-formed or did not validate against our published schema.',
  },
  MaxMessageLengthExceeded: { status: 400, message: 'Your request was too big.' },
  MetadataTooLarge: {
    status: 400,
    message: 'Your metadata headers exceed the maximum allowed metadata size.',
  },
  MethodNotAllowed: {
    status: 405,
    message: 'The specified method is not allowed against this resource.',
  },
  MissingContentLength: {
    status: 411,
    message: 'You must provide the Content-Length HTTP header.',
  },
  NoSuchBucket: { status: 404, message: 'The specified bucket does not exist' },
  NoSuchKey: { status: 404, message: 'The specified key does not exist.' },
  NoSuchUpload: {
    status: 404,
    message:
      'The specified upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.',
  },
  NotImplemented: {
    status: 501,
    message: 'A header or query you provided implies functionality that is not implemented.',
  },
  PreconditionFailed: {
    status: 412,
    message: 'At least one of the preconditions you specified did not hold.',
  },
  RequestTimeTooSkewed: {
    status: 403,
    message: "The difference between the request time and the server's time is too large.",
  },
  SignatureDoesNotMatch: {
    status: 403,
    message:
      'The request signature we calculated does not match the signature you provided. Check your key and signing method.',
  },
  XAmzContentSHA256Mismatch: {
    status: 400,
    message: "The provided 'x-amz-content-sha256' header does not match what was computed.",
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type S3ErrorCode = keyof typeof S3_ERRORS;

/**
 * 所有會回給客戶端的錯誤都用它表示；伺服器最外層把它序列化成 S3 的 `<Error>` XML。
 * `details` 會以額外的 XML 元素附在 `<Error>` 內（例：`<Key>`、`<BucketName>`）。
 */
export class S3Error extends Error {
  readonly status: number;

  constructor(
    readonly code: S3ErrorCode,
    message?: string,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message ?? S3_ERRORS[code].message);
    this.name = 'S3Error';
    this.status = S3_ERRORS[code].status;
  }
}

export function isS3Error(error: unknown): error is S3Error {
  return error instanceof S3Error;
}
