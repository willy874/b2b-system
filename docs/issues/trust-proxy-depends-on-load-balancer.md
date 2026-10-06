# 客戶端 IP 的信任鏈取決於前置 LB：每 IP 限流可能被偽造，或變成所有人共用

## 現況

`docker-compose.prod.yml` L110 寫死 `TRUST_PROXY: uniquelocal`，不能用變數覆寫。external-api 經 merge 也是同一個值。

三份 nginx 設定都以「附加」的方式轉送 `X-Forwarded-For`，也沒有 `real_ip` 設定：

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

- `deploy/nginx.conf` L40（`/api/socket.io/`）、L54（`/storage/`）、L83（`/api/`）。
- `deploy/nginx.platform.conf` L41、`deploy/nginx.external-api.conf` L32。

api 這邊，`main.ts` L28 以 `app.set('trust proxy', …)` 套用這個設定。以客戶端 IP 計數的地方：

- `common/guards/rate-limit.guard.ts` 的 `subjectOf()`（L97 取 `req.ip`）：登入類端點的「email＋IP」與 IP 桶、refresh、未登入請求的 IP 桶。
- `modules/api-token/external/api-token-auth.guard.ts` L71：對外 API 的驗證失敗計數。
- `modules/realtime/realtime.rate-limit.ts` 的 `clientIpOf()`（L49–52）：WebSocket handshake，用同一個 `proxy-addr` 設定。

`uniquelocal` 的判斷方式：從連線的對端開始，沿 `X-Forwarded-For` 由右往左走，略過私有位址（10/8、172.16/12、192.168/16、fc00::/7），取第一個公網位址。

其他相關設定與文件：

- compose 把 8080、8081、8082 綁在所有網路介面（L240、L265、L197）。
- [`01-system.md`](../architecture/01-system.md) §4.2（L255–256）寫「外部自帶的標頭無法偽造 IP」，但沒有寫出這句話成立所需的前置 LB 條件。
  對前置 LB 的要求只寫了 `X-Forwarded-Host`（L252–253）。

## 影響

只有在前置 LB 是「私有 IP、而且會把客戶端 IP 附加到 `X-Forwarded-For` 的 L7 代理」時，判斷才正確，例如同一個 VPC 的 ALB、同一台主機上的 Traefik。

實際部署用的是哪一種 LB 還沒確認。其他情況的結果：

1. 前置 LB 有私有 IP，但不附加 `X-Forwarded-For`（例如以 TLS listener 終結的 L4 LB）：
   - api 會採用客戶端自己帶的 `X-Forwarded-For`。每次換一個假 IP，就能繞過登入的「email＋IP」與 IP 桶、對外 API 的驗證失敗計數、WebSocket handshake 上限。
     帳號鎖定（同一帳號連續失敗 5 次）不受影響，仍然有效。
   - 沒帶這個標頭的正常使用者，全部算成 LB 那一個 IP，共用 `AUTH_IP_RATE_LIMIT` 與 `ANONYMOUS_RATE_LIMIT`。
2. 前置是公網 IP 的代理或 CDN（Cloudflare、GCP 的 HTTPS LB、Azure Front Door）：`req.ip` 會是邊緣節點的 IP。同一個節點後面的大量使用者共用 IP 桶，一個人就能讓他們全部登入不了。
3. Docker 的位址池不在 RFC1918 範圍（例如設成 100.64.0.0/10）：nginx 本身不被信任，所有人都算成 nginx 的 IP。
4. 主機的 8080、8081、8082 沒有擋外部連線時，可以繞過 LB 直接以明文 HTTP 連 nginx。
   這時 `req.ip` 是真實位址，不能偽造；但 TLS 與 LB 上的防護都被繞過了。

## 修正方式

1. （建議）nginx 先驗證來源，再覆寫標頭：

   ```nginx
   set_real_ip_from <LB 的網段>;
   real_ip_header X-Forwarded-For;
   real_ip_recursive on;
   …
   proxy_set_header X-Forwarded-For $remote_addr;   # 覆寫成單一值
   ```

   三份設定的每個 location 都要改。LB 的網段由部署決定，可以用環境變數產生設定，或在文件列出要改的地方。
2. api 只信任 nginx 這一跳：
   - compose 以 `ipam` 固定 `edge`、`external` 網路的子網路，`TRUST_PROXY` 設成那個子網路；或直接設 `TRUST_PROXY=1`。
   - compose 改成 `${TRUST_PROXY:-…}`，讓部署可以調整。
3. 在 01-system.md §4.2 寫清楚前置 LB 的要求：必須是 L7，並附加或覆寫 `X-Forwarded-For`。
   用 Cloudflare 之類的 CDN 時，改用它提供的真實 IP 標頭與來源網段清單。
4. 對外的 port 只綁在 LB 那一側的介面（例如 `'10.0.0.5:8080:8080'`），或用防火牆限制只有 LB 能連。

## 驗證方式

- 擴充 `deploy/check-nginx.sh`：從不在 `set_real_ip_from` 網段的來源送 `X-Forwarded-For: 1.2.3.4`，echo server 收到的 `x-forwarded-for` 必須是真實的連線位址，不能是 `1.2.3.4`。
- 部署前先確認：前置 LB 的種類、來源網段，以及它是否附加 `X-Forwarded-For`。
- 上線後從兩個不同的公網 IP 各做一次失敗的登入，api 日誌的 `ip` 欄位要分別是這兩個真實位址。
