// 自架 CDN 邊緣的 njs（docs/architecture/backend/09-file.md §16.3、§16.6；設定在 deploy/nginx.cdn.conf）：
//
// - reject：驗網址簽章，回傳拒絕的原因（空字串 = 放行）。sig = base64url(HMAC-SHA256(金鑰, exp + "\n" + 路徑))，路徑是解碼後的
//   $uri（含 /storage/<bucket>/）；金鑰依 kid 從 CDN_SIGNING_KEYS（與 api 的 FILE_CDN_SIGNING_KEYS 相同的金鑰環）選。
//   竄改、kid 不認得、沒有簽章 → signature；簽章對但過期 → expired；GET／HEAD 以外 → method。
//   原因放在回應的 X-CDN-Reject：api 的檢查以它區分「邊緣拒絕」與「源站的回應」（docs/architecture/backend/09-file.md §16.10）。
// - cacheControl：回應的 Cache-Control 依網址的剩餘效期決定，不沿用源站的 private。
// - originAuth：回源時帶的 X-Origin-Auth（CDN_ORIGIN_SECRET；沒設定時是空字串，nginx 就不送這個標頭）。
// - purge／purgeAll：清理端點（只在內部的 CDN_PURGE_PORT）。快取檔的位置由 key（$uri）的 md5 算出，刪掉就是清掉；
//   請求以 X-Purge-Signature = hex(HMAC-SHA256(CDN_PURGE_SECRET, ts + "\n" + 本體)) 驗證，ts 與現在相差 5 分鐘內。
// - status：GET /_status?ts=<ts>（同一個埠、同一把密鑰；沒有本體，簽的內容是 ts + "\n" + "GET /_status"）。
//   回報金鑰環的 kid（不回金鑰）、快取設定、映像版本與啟動時間；簽章被接受本身就證明清理密鑰一致。
//
// 秘密只從環境變數讀（nginx.cdn.conf 的 env 指令），不寫進產生的設定檔。

// njs 的模組名稱沒有 node: 前綴（載入 node:crypto 會失敗）
// oxlint-disable-next-line unicorn/prefer-node-protocol -- njs 只認得 crypto
import crypto from 'crypto';
// oxlint-disable-next-line unicorn/prefer-node-protocol -- njs 只認得 fs
import fs from 'fs';

// 與 nginx.cdn.conf 的 proxy_cache_path 相同（levels=1:2）
const CACHE_DIR = '/var/cache/nginx/cdn';
const PATH_PREFIX = '/storage/';
const PURGE_MAX_SKEW_SECONDS = 300;
const PURGE_MAX_PATHS = 1000;
const MAX_PATH_LENGTH = 1024;

let signingKeys;
let purgeSecret;

/** CDN_SIGNING_KEYS：<kid>:<base64>[,…]；格式由 deploy/nginx-cdn.sh 在啟動時檢查過。 */
function keyring() {
  if (signingKeys === undefined) {
    signingKeys = {};
    const raw = process.env.CDN_SIGNING_KEYS || '';
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .forEach((entry) => {
        const separator = entry.indexOf(':');
        if (separator > 0) {
          signingKeys[entry.slice(0, separator)] = Buffer.from(
            entry.slice(separator + 1),
            'base64',
          );
        }
      });
  }
  return signingKeys;
}

function purgeKey() {
  if (purgeSecret === undefined)
    purgeSecret = Buffer.from(process.env.CDN_PURGE_SECRET || '', 'base64');
  return purgeSecret;
}

/** 長度不同也走完整個比較：比對時間不洩漏前綴相同的長度。 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** 單一值的查詢參數；重複出現（陣列）視為不合法。 */
function single(value) {
  return typeof value === 'string' ? value : undefined;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** 拒絕的原因（X-CDN-Reject）；空字串 = 放行。OPTIONS 在 nginx.cdn.conf 先回 204，不會到這裡。 */
function reject(r) {
  if (r.method !== 'GET' && r.method !== 'HEAD') return 'method';
  const exp = single(r.args.exp);
  const kid = single(r.args.kid);
  const sig = single(r.args.sig);
  if (!exp || !kid || !sig || !/^[0-9]{1,12}$/.test(exp)) return 'signature';
  if (r.uri.indexOf(PATH_PREFIX) !== 0) return 'signature';
  const key = keyring()[kid];
  if (!key) return 'signature';
  const expected = crypto.createHmac('sha256', key).update(`${exp}\n${r.uri}`).digest('base64url');
  if (!safeEqual(expected, sig)) return 'signature';
  // 簽章對了才看效期：過期的網址與竄改的網址分開回報
  return Number(exp) <= nowSeconds() ? 'expired' : '';
}

/** 2xx 依網址的剩餘效期給 public；其他（404、5xx）不讓瀏覽器與中間的快取留著。 */
function cacheControl(r) {
  const code = r.status;
  const exp = Number(r.variables.cdn_exp);
  if (code < 200 || code >= 300 || !(exp > 0)) return 'no-store';
  return `public, max-age=${Math.max(0, exp - nowSeconds())}, immutable`;
}

function originAuth() {
  return process.env.CDN_ORIGIN_SECRET || '';
}

/** 快取檔的位置：<目錄>/<md5 最後 1 碼>/<倒數第 2～3 碼>/<md5>（levels=1:2）。 */
function cacheFileOf(key) {
  const md5 = crypto.createHash('md5').update(key).digest('hex');
  return `${CACHE_DIR}/${md5.slice(-1)}/${md5.slice(-3, -1)}/${md5}`;
}

function reply(r, code, body) {
  r.headersOut['Content-Type'] = 'application/json';
  r.return(code, JSON.stringify(body));
}

/** 驗 X-Purge-Signature：HMAC(CDN_PURGE_SECRET, ts + "\n" + 內容)，ts 與現在相差 5 分鐘內。 */
function signedWithPurgeSecret(r, ts, content) {
  const key = purgeKey();
  return (
    typeof ts === 'number' &&
    Math.abs(nowSeconds() - ts) <= PURGE_MAX_SKEW_SECONDS &&
    key.length >= 32 &&
    safeEqual(
      crypto.createHmac('sha256', key).update(`${ts}\n${content}`).digest('hex'),
      r.headersIn['X-Purge-Signature'],
    )
  );
}

/** 驗本體與簽章；不通過時已回應，回傳 undefined。 */
function authorizedBody(r) {
  if (r.method !== 'POST') {
    reply(r, 405, { error: 'method' });
    return undefined;
  }
  const text = r.requestText;
  if (!text) {
    reply(r, 400, { error: 'body' });
    return undefined;
  }
  let body;
  try {
    body = JSON.parse(text);
    // oxlint-disable-next-line no-unused-vars -- njs 不支援省略 catch 的參數（optional catch binding）
  } catch (e) {
    reply(r, 400, { error: 'json' });
    return undefined;
  }
  if (!signedWithPurgeSecret(r, body && body.ts, text)) {
    reply(r, 403, { error: 'signature' });
    return undefined;
  }
  return body;
}

/** 與 api 的 CDN_STATUS_SIGNED_CONTENT（apps/api/src/core/storage/cdn-edge-purger.ts）相同。 */
const STATUS_SIGNED_CONTENT = 'GET /_status';

/** 金鑰環的 kid，依 CDN_SIGNING_KEYS 的順序（金鑰不回傳）。 */
function kidsOf() {
  return (process.env.CDN_SIGNING_KEYS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.indexOf(':') > 0)
    .map((entry) => entry.slice(0, entry.indexOf(':')));
}

function status(r) {
  if (r.method !== 'GET') {
    reply(r, 405, { error: 'method' });
    return;
  }
  const raw = single(r.args.ts);
  const ts = raw && /^[0-9]{1,12}$/.test(raw) ? Number(raw) : undefined;
  if (!signedWithPurgeSecret(r, ts, STATUS_SIGNED_CONTENT)) {
    reply(r, 403, { error: 'signature' });
    return;
  }
  // 快取設定、版本、啟動時間由 deploy/nginx-cdn.sh 在啟動時寫進設定（nginx.cdn.conf 的 set）
  reply(r, 200, {
    kids: kidsOf(),
    cache: {
      maxSize: r.variables.cdn_cache_max_size,
      inactive: r.variables.cdn_cache_inactive,
      valid: r.variables.cdn_cache_valid,
    },
    build: r.variables.cdn_build,
    startedAt: r.variables.cdn_started_at,
  });
}

function unlink(path) {
  try {
    fs.unlinkSync(path);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

function purge(r) {
  const body = authorizedBody(r);
  if (!body) return;
  const paths = body.paths;
  if (
    !Array.isArray(paths) ||
    paths.length > PURGE_MAX_PATHS ||
    !paths.every(
      (path) =>
        typeof path === 'string' &&
        path.indexOf(PATH_PREFIX) === 0 &&
        path.length <= MAX_PATH_LENGTH,
    )
  ) {
    reply(r, 400, { error: 'paths' });
    return;
  }
  let purged = 0;
  let missing = 0;
  try {
    paths.forEach((path) => {
      if (unlink(cacheFileOf(path))) purged++;
      else missing++;
    });
  } catch (e) {
    r.error(`cdn purge failed: ${e.message}`);
    reply(r, 500, { error: 'unlink' });
    return;
  }
  reply(r, 200, { purged, missing });
}

function entries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function purgeAll(r) {
  const body = authorizedBody(r);
  if (!body) return;
  let purged = 0;
  try {
    // 只刪檔案、留下目錄（cache manager 與正在寫入的 worker 都假設目錄存在）
    entries(CACHE_DIR).forEach((first) => {
      if (!first.isDirectory()) return;
      entries(`${CACHE_DIR}/${first.name}`).forEach((second) => {
        if (!second.isDirectory()) return;
        entries(`${CACHE_DIR}/${first.name}/${second.name}`).forEach((file) => {
          if (
            !file.isDirectory() &&
            unlink(`${CACHE_DIR}/${first.name}/${second.name}/${file.name}`)
          ) {
            purged++;
          }
        });
      });
    });
  } catch (e) {
    r.error(`cdn purge all failed: ${e.message}`);
    reply(r, 500, { error: 'unlink' });
    return;
  }
  reply(r, 200, { purged, missing: 0 });
}

export default { reject, cacheControl, originAuth, purge, purgeAll, status };
