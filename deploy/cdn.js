// 自架 CDN 邊緣的 njs（docs/architecture/backend/09-file.md §16.3、§16.6；設定在 deploy/nginx.cdn.conf）：
//
// - verify：驗網址簽章。sig = base64url(HMAC-SHA256(金鑰, exp + "\n" + 路徑))，路徑是解碼後的 $uri（含 /storage/<bucket>/）；
//   金鑰依 kid 從 CDN_SIGNING_KEYS（與 api 的 FILE_CDN_SIGNING_KEYS 相同的金鑰環）選。過期、竄改、kid 不認得一律不通過。
// - cacheControl：回應的 Cache-Control 依網址的剩餘效期決定，不沿用源站的 private。
// - originAuth：回源時帶的 X-Origin-Auth（CDN_ORIGIN_SECRET；沒設定時是空字串，nginx 就不送這個標頭）。
// - purge／purgeAll：清理端點（只在內部的 CDN_PURGE_PORT）。快取檔的位置由 key（$uri）的 md5 算出，刪掉就是清掉；
//   請求以 X-Purge-Signature = hex(HMAC-SHA256(CDN_PURGE_SECRET, ts + "\n" + 本體)) 驗證，ts 與現在相差 5 分鐘內。
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

function verify(r) {
  const exp = single(r.args.exp);
  const kid = single(r.args.kid);
  const sig = single(r.args.sig);
  if (!exp || !kid || !sig || !/^[0-9]{1,12}$/.test(exp)) return '0';
  if (Number(exp) <= nowSeconds()) return '0';
  if (r.uri.indexOf(PATH_PREFIX) !== 0) return '0';
  const key = keyring()[kid];
  if (!key) return '0';
  const expected = crypto.createHmac('sha256', key).update(`${exp}\n${r.uri}`).digest('base64url');
  return safeEqual(expected, sig) ? '1' : '0';
}

/** 2xx 依網址的剩餘效期給 public；其他（404、5xx）不讓瀏覽器與中間的快取留著。 */
function cacheControl(r) {
  const status = r.status;
  const exp = Number(r.variables.cdn_exp);
  if (status < 200 || status >= 300 || !(exp > 0)) return 'no-store';
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

function reply(r, status, body) {
  r.headersOut['Content-Type'] = 'application/json';
  r.return(status, JSON.stringify(body));
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
  const ts = body && body.ts;
  const signature = r.headersIn['X-Purge-Signature'];
  const key = purgeKey();
  if (
    typeof ts !== 'number' ||
    Math.abs(nowSeconds() - ts) > PURGE_MAX_SKEW_SECONDS ||
    key.length < 32 ||
    !safeEqual(crypto.createHmac('sha256', key).update(`${ts}\n${text}`).digest('hex'), signature)
  ) {
    reply(r, 403, { error: 'signature' });
    return undefined;
  }
  return body;
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

export default { verify, cacheControl, originAuth, purge, purgeAll };
