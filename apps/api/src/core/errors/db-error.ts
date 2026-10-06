/**
 * 查詢失敗的錯誤（drizzle 的 `DrizzleQueryError`）：訊息是 `Failed query: <SQL>\nparams: <所有參數>`，
 * `params` 屬性與堆疊的第一行也帶著全部參數——密碼雜湊、token、IdP 的授權碼、個資。
 * 以形狀判斷（字串 `query` ＋ 陣列 `params`），不依賴 drizzle 的類別。
 */
interface QueryError extends Error {
  query: string;
  params: unknown[];
}

function isQueryError(error: unknown): error is QueryError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<QueryError>;
  return typeof candidate.query === 'string' && Array.isArray(candidate.params);
}

/**
 * 驅動錯誤（postgres.js 的 `PostgresError`）只留這三個欄位：`detail`、`where` 這些會帶到資料的值
 * （例：`Key (email)=(…) already exists`）。`code` 與 `constraint_name` 讓錯誤對應（`postgres-error.ts`）與排查照常可用。
 */
export interface DbErrorCause {
  code?: string;
  constraint_name?: string;
  message?: string;
}

/** 不含參數的查詢錯誤描述：日誌的 `err` 與背景工作的 output 都只有這些。 */
export interface DbErrorDescription {
  type: string;
  /** `Failed query: <SQL>`；SQL 裡的值是 `$1` 這類佔位。 */
  message: string;
  query: string;
  /** 原本的堆疊位置，第一行換成不含參數的訊息。 */
  stack: string;
  cause?: DbErrorCause;
}

/** 由 `redactDbError()` 產生、不帶參數的查詢錯誤。 */
export class DbQueryError extends Error {
  readonly query: string;
  override readonly cause: DbErrorCause | undefined;

  constructor(description: DbErrorDescription) {
    super(description.message);
    this.name = 'DbQueryError';
    this.query = description.query;
    this.cause = description.cause;
    this.stack = description.stack;
  }
}

function causeOf(cause: unknown): DbErrorCause | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined;
  const source = cause as Record<string, unknown>;
  const picked: DbErrorCause = {};
  for (const key of ['code', 'constraint_name', 'message'] as const) {
    const value = source[key];
    if (typeof value === 'string') picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function describeQueryError(error: QueryError): DbErrorDescription {
  const type = error.constructor.name;
  const message = `Failed query: ${error.query}`;
  // 堆疊的開頭是原本的訊息（含參數）：只留在它之後的呼叫位置；找不到就整個不留
  const stack = error.stack ?? '';
  const at = stack.indexOf(error.message);
  const frames = at === -1 ? '' : stack.slice(at + error.message.length);
  return {
    type,
    message,
    query: error.query,
    stack: `${type}: ${message}${frames}`,
    cause: causeOf(error.cause),
  };
}

/**
 * 查詢錯誤的不含參數版本（docs/conventions/03-backend.md §7）：只留型別、SQL 本文、堆疊位置與驅動錯誤的
 * `code`／`constraint_name`／`message`。不是查詢錯誤回 `undefined`。
 */
export function describeDbError(error: unknown): DbErrorDescription | undefined {
  if (error instanceof DbQueryError) {
    return {
      type: error.name,
      message: error.message,
      query: error.query,
      stack: error.stack ?? '',
      cause: error.cause,
    };
  }
  return isQueryError(error) ? describeQueryError(error) : undefined;
}

/**
 * 把查詢錯誤換成不帶參數的 `DbQueryError`；其他錯誤原樣回傳。用在錯誤會被整個存下來或交給別人序列化的地方
 * （例：pg-boss 把拋出的錯誤連同所有可列舉的屬性存成工作的 output）。
 */
export function redactDbError(error: unknown): unknown {
  return isQueryError(error) ? new DbQueryError(describeQueryError(error)) : error;
}
