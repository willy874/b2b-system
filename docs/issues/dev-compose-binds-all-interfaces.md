# 開發用 compose 把 postgres 與 Mailpit 綁在所有網路介面

## 現況

`docker-compose.yml`：

```yaml
postgres:
  environment:
    POSTGRES_USER: …          # L7–9：帳密是寫在這個檔案裡的固定值（超級使用者）
  ports:
    - '5432:5432'             # L10–11
mailpit:
  ports:
    - '1025:1025'             # L26–28
    - '8025:8025'
```

- `ports` 沒有寫位址時，Docker 會綁在 `0.0.0.0`。Docker Desktop 也一樣。
- repo 是 public，開發 DB 的帳密與 `.env.example`（L3、L18）的連線字串都是公開的。
- Mailpit 的網頁（:8025）沒有驗證，看得到所有寄出的信，包括啟用與重設密碼的連結。
- 開發時 api 以 `app.listen(port)`（`apps/api/src/main.ts` L43）監聽所有介面的 :3000。
- file-storage 預設只聽 `127.0.0.1`（`.env.example` L94），Vite 預設只聽 localhost，這兩個沒問題。

## 影響

同一個網段（咖啡廳、共用辦公室、公司 Wi-Fi）的人可以：

- 用公開的帳密以超級使用者連上開發 DB，讀寫所有開發資料。超級使用者還能用 `COPY … TO PROGRAM` 在 postgres 容器裡執行指令。
- 從 Mailpit 拿到啟用與重設密碼的連結，接管開發環境的帳號。

只影響開發機，前提是作業系統的防火牆沒有擋這些 port。如果開發資料是從正式資料複製來的，影響更大。

## 修正方式

1. `docker-compose.yml` 改成只綁 loopback：

   ```yaml
   ports:
     - '127.0.0.1:5432:5432'
   …
     - '127.0.0.1:1025:1025'
     - '127.0.0.1:8025:8025'
   ```

2. 開發時 api 只聽 127.0.0.1：例如改成 `app.listen(port, host)`，`host` 在 development 預設 `127.0.0.1`，可以用環境變數覆寫。
   production 的容器仍要聽所有介面，因為 nginx 是從另一個容器連進來的。
3. 需要從其他機器連的人（例如用手機測試），自己在本機覆寫，例如放一份 `docker-compose.override.yml`。

## 驗證方式

- `docker compose up -d postgres mailpit` 之後執行 `docker compose ps`，PORTS 欄顯示 `127.0.0.1:5432->5432/tcp` 等。
- 從同網段的另一台機器執行 `nc -vz <開發機 IP> 5432`，以及對 8025 做同樣的測試，都連不上。
- `pnpm dev` 與 `pnpm test:e2e` 照常運作，因為它們都是從本機連。
