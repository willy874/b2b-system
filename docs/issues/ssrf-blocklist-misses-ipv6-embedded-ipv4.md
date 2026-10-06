# 對外連線的位址檢查沒有擋內嵌 IPv4 的 IPv6 位址（NAT64、6to4 等）

## 現況

`apps/api/src/core/http/outbound.ts` 的封鎖清單（L17–41）：

- IPv4 擋了私有網段、loopback、link-local、CGNAT 與保留位址。
- IPv6 只有這幾段：

  ```ts
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ```

`isBlockedAddress()`（L43–50）：

- IPv4-mapped（`::ffff:a.b.c.d`）以 IPv4 規則判斷；
- 十六進位寫法（`::ffff:7f00:1`）由 Node 的 `BlockList` 對應到 IPv4，已實測會擋。

沒有涵蓋的，是位址裡「內嵌 IPv4」的其他前綴：

| 前綴 | 例 | 內嵌的 IPv4 |
| --- | --- | --- |
| `64:ff9b::/96`（NAT64，well-known） | `64:ff9b::a9fe:a9fe` | 169.254.169.254 |
| `64:ff9b:1::/48`（NAT64，local-use） | `64:ff9b:1::a00:5`（以 /96 子前綴內嵌時） | 10.0.0.5 |
| `2002::/16`（6to4） | `2002:a00:5::1` | 10.0.0.5 |
| `::/96`（IPv4-compatible，已廢止） | `::7f00:1` | 127.0.0.1 |
| `::ffff:0:0:0/96`（IPv4-translated） | `::ffff:0:a00:5` | 10.0.0.5 |
| `2001::/32`（Teredo，用戶端位址與 `0xffffffff` 做 XOR） | `2001:0:4136:e378:8000:63bf:f5ff:fffa` | 10.0.0.5 |

- 以 node 實測，上表的例子 `isBlockedAddress()` 全部回 false。
- 網址直接寫成 `https://[64:ff9b::a00:5]/` 也會通過。
- 另外還有已廢止的 site-local `fec0::/10`，同樣沒擋。

用到這份清單的地方（只在 production，`blockPrivateNetworks`）：

- webhook：
  - 儲存時：`modules/webhook/webhook.transport.ts` 的 `normalizeUrl()`（L53 起）呼叫 `assertPublicDestination()`。
  - 投遞時：`send()`（L79 起）呼叫 `sendOutboundRequest()`。
    - 字面 IP 由 `outbound.ts` L178–180 檢查。
    - 主機名稱由 `pinnedLookup()` 在連線時檢查（L185）。
- 外部 IdP：`modules/identity-provider/external-oidc.client.ts` 的 `configOf()` 以 `guardedFetch()` 處理每個請求（L130；`outbound.ts` L120–127）。

攻擊步驟：

1. 在 production 建立 webhook，網址填 `https://ssrf.attacker.example/`。這個網域的 AAAA 紀錄指向 `64:ff9b::a00:5`；也可以直接填 `https://[64:ff9b::a00:5]/`。
2. 儲存時的 `assertPublicDestination()` 與投遞時的 `pinnedLookup()` 都放行。
3. `POST /webhooks/:id/test` 同步送出。
4. 投遞紀錄存下回應的前 1 KB（`webhook_deliveries.response_body`），持有 `webhook:read` 的人看得到。

## 影響

前提：api 所在的網路要有路由，把這些前綴轉成 IPv4。

- 最常見的是 NAT64：
  - IPv6-only 或雙協定的 k8s 叢集；
  - 開了 DNS64／NAT64 的雲端子網路，例如 AWS 子網路把 `64:ff9b::/96` 指向 NAT gateway。
- 純 IPv4 的 docker compose 部署連不到這些位址，不受影響。
- 目前的部署環境有沒有這種路由，要另外確認。

前提成立時：

- 持有 `webhook:create` 或 `webhook:update` 的租戶管理者，可以讓 api 對內網的 IPv4 位址發 POST，並讀回回應的開頭。
- 這會繞過 [`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §9.2 D15 的防護。
- 外部 IdP 的 issuer（`identityProvider:*`）同理，只是發的是 GET。
- 雲端的 metadata 端點通常不會經過 NAT gateway 轉送。主要的風險是內網裡的其他服務。

## 修正方式

擇一，建議 1：

1. `isBlockedAddress()` 先取出內嵌的 IPv4，再用 IPv4 的清單判斷：
   - `64:ff9b::/96`、`::ffff:0:0:0/96`，以及 `::/96`（`::` 與 `::1` 已在清單裡）：取最後 32 位元；
   - `64:ff9b:1::/48`：整段擋下。內嵌的位置依各網路選的格式而定（RFC 6052），無法可靠地取出；
   - `2002::/16`：取第 17～48 位元；
   - `2001::/32`（Teredo）：取最後 32 位元，再與 `0xffffffff` 做 XOR。
   - 取出的 IPv4 落在 IPv4 封鎖清單就擋。透過 NAT64 連公開 IPv4 的合法用途（IPv6-only 環境的接收端）照常可用。
2. 把上述前綴整段加進 `BLOCKED`。
   - 比較簡單，但會連帶擋掉透過 NAT64 連公開 IPv4 的合法用途。
3. 更嚴格的做法：IPv6 只放行 `2000::/3`（全球單播），再扣掉上面的前綴與文件用的 `2001:db8::/32`。

不論哪一種，[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §5 的 `isBlockedAddress` 說明都要補上這些前綴。

## 驗證方式

- `apps/api/src/core/http/__tests__/outbound.spec.ts` 的 `it.each` 表（L29–44）：
  - 加上表的每一個例子，預期 true；
  - 加 `64:ff9b::808:808`（8.8.8.8），方案 1 預期 false，方案 2 預期 true。
- 同一個檔案「擋內網時，解析到 loopback 的主機名稱不會建立連線」那一段，補一個解析到 `64:ff9b::7f00:1` 的案例。
- 同一個檔案「擋內網時，字面 IP 的內網位址直接拒絕」那一段，補 `https://[64:ff9b::a00:5]/`。
