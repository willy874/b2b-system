#!/usr/bin/env sh
# 以一次性的假金鑰與網址建置並啟動整套 docker-compose.prod.yml（需要 Docker），確認：
#   - compose 的必填變數齊全（docker compose config）
#   - 每個服務都 healthy（含 production 的環境變數驗證：api 起不來就不會 healthy）
#   - 三個 nginx 都轉得到後端
#   - APM 開啟時前端錯誤送得進 apm-service；--no-apm 時 APM 整套關閉，apm-service 不啟動、/apm/ 回 404
# CI（.github/workflows/ci.yml 的 deploy job）與部署前的手動檢查共用。結束時刪掉容器與 volume。
# 會用到主機的 8080～8082。
#
# 用法：sh deploy/smoke-test.sh [--no-apm]
set -eu

cd "$(dirname "$0")/.."
PROJECT=b2b-smoke-$$
ENV_FILE=$(mktemp)

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"
}

cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    compose ps -a || true
    compose logs --tail 50 || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

fail() {
  echo "✗ $1" >&2
  exit 1
}

node deploy/fake-prod-env.mjs "$@" >"$ENV_FILE"
APM=true
[ "${1:-}" = "--no-apm" ] && APM=false

echo "── docker compose config"
compose config --quiet

echo "── build ＋ up（等每個服務 healthy）"
compose up -d --build --wait --wait-timeout 300

echo "── 經 nginx 打 api"
curl -fsS -o /dev/null http://127.0.0.1:8080/api/health/ready || fail "backstage → api 的 /health/ready 失敗"
curl -fsS -o /dev/null http://127.0.0.1:8081/api/health || fail "platform → api 的 /health 失敗"
curl -fsS -o /dev/null http://127.0.0.1:8082/health || fail "external-gateway → external-api 的 /health 失敗"

if [ "$APM" = "false" ]; then
  echo "── APM 關閉：沒有 apm-service，/apm/ 回 404"
  compose ps --services | grep -qx apm-service && fail "APM 關閉時不應該啟動 apm-service"
  for port in 8080 8081; do
    status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/apm/api/1/envelope/?sentry_key=k")
    [ "$status" = "404" ] || fail "$port 的 /apm/ 應回 404（$status）"
  done
  echo "✓ docker-compose.prod.yml（APM 關閉）"
  exit 0
fi

echo "── 經 nginx 送前端錯誤到 apm-service"
envelope() {
  printf '{}\n{"type":"event"}\n{"message":"smoke test","platform":"javascript"}\n'
}
for target in "8080 1 APM_BACKSTAGE_PUBLIC_KEY" "8081 2 APM_PLATFORM_PUBLIC_KEY"; do
  set -- $target
  key=$(grep "^$3=" "$ENV_FILE" | cut -d= -f2)
  envelope | curl -fsS -o /dev/null -X POST --data-binary @- \
    "http://127.0.0.1:$1/apm/api/$2/envelope/?sentry_key=$key" || fail "$1 → apm-service 的收件失敗"
done

echo "✓ docker-compose.prod.yml"
