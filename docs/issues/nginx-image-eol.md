# 三個 nginx 映像釘在已停止更新的 1.27，node 與 postgres 映像也沒有釘 digest

## 現況

`nginxinc/nginx-unprivileged:1.27-alpine` 用在四個地方：

- `apps/backstage/Dockerfile` L33、`apps/platform/Dockerfile` L33：兩個前端的 runtime。
- `docker-compose.prod.yml` L194：`external-gateway`。
- `deploy/check-nginx.sh` L12。

1.27 是 nginx 舊的 mainline 分支，已被之後的 stable 與 mainline 取代，不會再有修補。2026-10-06 在 Docker Hub 查詢的結果（`hub.docker.com/v2/repositories/nginxinc/nginx-unprivileged/tags/<tag>`）：

- `1.27-alpine` 的 `tag_last_pushed` 是 2025-06-23。
- 同一個 repo 的 `stable-alpine` 在 2026-10-05 仍有推送。

其他映像都只用浮動的 tag，沒有釘 digest：

- `node:24-alpine`：四個 Dockerfile 的 build 與 runtime stage（api L2、L25；backstage L2；platform L2；file-storage L5、L20），以及 `deploy/check-nginx.sh` L13。
- `postgres:17-alpine`：`docker-compose.prod.yml` L8，開發用的 `docker-compose.yml` L3 也是。

repo 裡沒有任何自動更新映像的設定（Renovate、Dependabot），見 [`no-ci-pipeline.md`](./no-ci-pipeline.md)。

## 影響

- 三個 nginx 容器是所有對外流量的第一跳：backstage、apps/platform、對外 API 閘道。
  2025-06 之後 nginx 本身與 Alpine 套件（openssl、zlib、musl…）的安全修補都進不來，重新建置映像也拿不到。
- 浮動的 tag 讓同一個 commit 在不同時間建置時拿到不同的基底。出問題時很難重現，也無法確認上線的是哪一版。
- 目前沒有查到特定、正在被利用的漏洞。風險在於「沒有更新」本身，而且會隨時間增加。

## 修正方式

1. 改用仍在維護的分支，例如 `nginxinc/nginx-unprivileged:stable-alpine` 目前對應的版本，並寫成明確的版本號（`<版本>-alpine`）。上面四個地方一起改。
2. 所有基底映像都以 digest 釘住：`node:24-alpine@sha256:…`、`postgres:17-alpine@sha256:…`，nginx 也一樣。
3. 加 Renovate（或 Dependabot 的 `docker` 生態系），定期提出更新 digest 的 PR，搭配 CI 建置與 `sh deploy/check-nginx.sh`。

## 驗證方式

- `docker run --rm <新映像> nginx -v` 顯示的是仍在維護的版本。
- `sh deploy/check-nginx.sh` 通過：安全標頭、X-Forwarded-Host 覆寫、keepalive 都正常。
- 以 trivy 或 grype 掃描三個前端映像，沒有「已有修補卻還沒更新」的高風險項目。
