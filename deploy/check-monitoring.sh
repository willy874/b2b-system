#!/bin/sh
# 監控設定的檢查（docs/architecture/08-monitoring.md §8；CI 的 deploy job 也跑）：
#   1. docker-compose.prod.yml 疊上 docker-compose.monitoring.yml 之後的設定是否合法（以一次性的假金鑰；APM 開啟與關閉各一次），
#      以及沒疊監控（監控關閉）時的設定
#   2. Prometheus 的設定與告警規則（promtool；正式與本機兩份設定）
#   3. Grafana 儀表板：JSON 合法、每個查詢都指向有登記的資料來源 uid
# 需要 Docker。
#
# 用法：sh deploy/check-monitoring.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 與 docker-compose.monitoring.yml 相同的映像（digest 一起改）
PROMETHEUS_IMAGE=prom/prometheus:v3.13.4@sha256:87861b8cf91579109319ebc300f3f1060e6da9c05d6ae8ad15a20c879e84e32e

echo '── compose（正式 ＋ 監控）'
node "$ROOT/deploy/fake-prod-env.mjs" > "$WORK/prod.env"
printf 'GRAFANA_ADMIN_PASSWORD=%s\nPOSTGRES_MONITOR_PASSWORD=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" >> "$WORK/prod.env"
docker compose --project-directory "$ROOT" --env-file "$WORK/prod.env" \
  -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/docker-compose.monitoring.yml" config --quiet
# APM 整套關閉（沒有 apm profile、沒有 APM_* 金鑰）時監控照樣能疊上（docs/architecture/08-monitoring.md §1.1）
node "$ROOT/deploy/fake-prod-env.mjs" --no-apm > "$WORK/prod-no-apm.env"
printf 'GRAFANA_ADMIN_PASSWORD=%s\nPOSTGRES_MONITOR_PASSWORD=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" >> "$WORK/prod-no-apm.env"
docker compose --project-directory "$ROOT" --env-file "$WORK/prod-no-apm.env" \
  -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/docker-compose.monitoring.yml" config --quiet
# 監控整套關閉 = 不疊 docker-compose.monitoring.yml；APM 開關兩種都要合法
for env in prod.env prod-no-apm.env; do
  docker compose --project-directory "$ROOT" --env-file "$WORK/$env" -f "$ROOT/docker-compose.prod.yml" config --quiet
done
docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" --profile monitoring config --quiet

echo '── Prometheus 的設定與告警規則'
for config in prometheus.yml prometheus.dev.yml; do
  docker run --rm --entrypoint promtool \
    -v "$ROOT/deploy/monitoring/$config:/etc/prometheus/prometheus.yml:ro" \
    -v "$ROOT/deploy/monitoring/rules:/etc/prometheus/rules:ro" \
    "$PROMETHEUS_IMAGE" check config /etc/prometheus/prometheus.yml
done

echo '── Grafana 儀表板'
node --input-type=module - "$ROOT/deploy/monitoring/grafana/dashboards" <<'EOF'
import { readdirSync, readFileSync } from 'node:fs';

// deploy/monitoring/grafana/provisioning/datasources/datasources.yaml 登記的 uid
const DATASOURCES = new Set(['prometheus', 'tempo', 'apm']);
const dir = process.argv[2];
const uids = new Set();
let failures = 0;
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
  const board = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  if (uids.has(board.uid)) {
    console.error(`${file}: uid ${board.uid} 重複`);
    failures += 1;
  }
  uids.add(board.uid);
  for (const panel of board.panels ?? []) {
    for (const target of [panel, ...(panel.targets ?? [])]) {
      const uid = target.datasource?.uid;
      if (uid !== undefined && !DATASOURCES.has(uid)) {
        console.error(`${file}「${panel.title}」：資料來源 ${uid} 沒有登記`);
        failures += 1;
      }
    }
  }
  console.log(`${file}：${board.panels.length} 個面板`);
}
if (failures > 0) process.exit(1);
EOF

echo '監控設定檢查通過'
