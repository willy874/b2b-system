// deploy/check-cdn.sh 的小工具（不依賴任何套件，在 node 容器裡執行）：簽 CDN 網址、以 SigV4 寫入／刪除物件、送清理請求、讀 /_status。
// 簽章與清理的格式與 api 相同（apps/api/src/core/storage/cdn-url-signer.ts、cdn-edge-purger.ts），在這裡另寫一份是為了
// 不必在 CI 的 deploy job 安裝 workspace 的依賴；兩邊的格式改了要一起改。只拿來驗證，不要用在正式環境。
//
//   node cdn-check.mjs sign <路徑> <exp> <kid> <base64 金鑰>         → 印出 ?exp=…&kid=…&sig=…
//   node cdn-check.mjs s3 <PUT|DELETE> <網址> [內容]                 → 以 S3_ACCESS_KEY_ID／S3_SECRET_ACCESS_KEY 簽 SigV4，印出狀態碼
//   node cdn-check.mjs purge <清理網址> <base64 密鑰> <路徑,…|all> [ts 偏移秒] [bad]
//                                                                    → 送到名稱解析出來的每個位址，每個節點印一行「位址 狀態碼 本體」
//   node cdn-check.mjs status <清理網址> <base64 密鑰> [ts 偏移秒] [bad]
//                                                                    → GET /_status（簽 ts + "\n" + "GET /_status"），同上每個節點一行
import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:http';

const [command, ...args] = process.argv.slice(2);

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function send(options, body) {
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function sign([path, exp, kid, key]) {
  const sig = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(`${exp}\n${path}`)
    .digest('base64url');
  process.stdout.write(`?exp=${exp}&kid=${encodeURIComponent(kid)}&sig=${sig}\n`);
}

/** path-style、header 的 SigV4，內容不簽（UNSIGNED-PAYLOAD）。 */
async function s3([method, target, content = '']) {
  const url = new URL(target);
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secret = process.env.S3_SECRET_ACCESS_KEY;
  const region = 'us-east-1';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const headers = {
    host: url.host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).join(';');
  // file-storage 的 canonicalUri：逐段解碼再以 SigV4 的規則編碼（@ → %40）
  const canonicalPath = url.pathname
    .split('/')
    .map((segment) =>
      encodeURIComponent(decodeURIComponent(segment)).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
  const canonical = [
    method,
    canonicalPath,
    '',
    ...Object.entries(headers).map(([name, value]) => `${name}:${value}`),
    '',
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  let key = hmac(`AWS4${secret}`, date);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  const body = Buffer.from(content);
  const response = await send(
    {
      host: url.hostname,
      port: url.port,
      method,
      path: url.pathname,
      headers: {
        ...headers,
        'content-length': body.length,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    },
    body,
  );
  process.stdout.write(`${response.status}\n`);
}

async function purge([target, secret, paths, offset = '0', bad]) {
  const url = new URL(target);
  const ts = Math.floor(Date.now() / 1000) + Number(offset);
  const isAll = paths === 'all';
  const body = JSON.stringify(isAll ? { ts } : { paths: paths.split(','), ts });
  let signature = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${ts}\n${body}`)
    .digest('hex');
  if (bad) signature = signature.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const addresses = [...new Set((await lookup(url.hostname, { all: true })).map((a) => a.address))];
  for (const address of addresses.toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- 依序送出，輸出的順序固定（check-cdn.sh 逐行比對）
    const response = await send(
      {
        host: address,
        port: url.port,
        method: 'POST',
        path: isAll ? '/_purge/all' : '/_purge',
        headers: {
          host: url.host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-purge-signature': signature,
        },
      },
      body,
    );
    process.stdout.write(`${address} ${response.status} ${response.text}\n`);
  }
}

async function status([target, secret, offset = '0', bad]) {
  const url = new URL(target);
  const ts = Math.floor(Date.now() / 1000) + Number(offset);
  let signature = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${ts}\nGET /_status`)
    .digest('hex');
  if (bad) signature = signature.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  const addresses = [...new Set((await lookup(url.hostname, { all: true })).map((a) => a.address))];
  for (const address of addresses.toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- 依序送出，輸出的順序固定（check-cdn.sh 逐行比對）
    const response = await send({
      host: address,
      port: url.port,
      method: 'GET',
      path: `/_status?ts=${ts}`,
      headers: { host: url.host, 'x-purge-signature': signature },
    });
    process.stdout.write(`${address} ${response.status} ${response.text}\n`);
  }
}

const commands = { sign, s3, purge, status };
if (!commands[command]) {
  process.stderr.write(`不認得的指令：${command}\n`);
  process.exit(2);
}
await commands[command](args);
