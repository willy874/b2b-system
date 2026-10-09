#!/usr/bin/env sh
# k8s 的參考部署（deploy/k8s，docs/architecture/01-system.md §7 D15）：兩個 overlay 都要能以 kustomize 產生，
# 並通過 Kubernetes 的 schema 檢查（kubeconform，strict：拼錯的欄位也算錯）。需要 kubectl（內建 kustomize）與 Docker。
# 不起叢集：探針、角色與排空的行為由 api 的測試與 deploy/smoke-test.sh --cluster 驗證。
# components/cdn 另外以 Docker 模擬 Pod 的規格（唯讀根目錄、drop ALL、emptyDir、兩個副本、headless Service 的名稱解析），
# 確認邊緣就緒、/_status 的簽章檢查通過、清理用的名稱在 k8s 的 search domain 之下解析到每一個副本（docs/architecture/backend/09-file.md §16.8）。
#
# 用法：sh deploy/check-k8s.sh
set -eu

K8S_DIR=$(cd "$(dirname "$0")/k8s" && pwd)
KUBECONFORM_IMAGE=ghcr.io/yannh/kubeconform:v0.7.0@sha256:85dbef6b4b312b99133decc9c6fc9495e9fc5f92293d4ff3b7e1b30f5611823c
# 與 CI 的 runner 上常見的叢集版本相近；schema 取自 kubeconform 的預設來源
KUBERNETES_VERSION=1.33.0
# api 的映像的基底（apps/api/Dockerfile；digest 一起更新）：模擬 api 的 Pod 解析清理端點
NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

fail() {
  echo "✗ $1" >&2
  exit 1
}

for overlay in standalone cluster; do
  echo "── overlays/$overlay"
  rendered=$(kubectl kustomize "$K8S_DIR/overlays/$overlay") || fail "$overlay：kustomize 產生失敗"
  echo "$rendered" | docker run --rm -i "$KUBECONFORM_IMAGE" -strict -summary \
    -kubernetes-version "$KUBERNETES_VERSION" - || fail "$overlay：schema 檢查失敗"
  # 每個角色的程序都讀同一份設定（金鑰要相同，D5）
  echo "$rendered" | grep -q 'name: b2b-api-secrets' || fail "$overlay：api 沒有讀 b2b-api-secrets"
done

cluster=$(kubectl kustomize "$K8S_DIR/overlays/cluster")
for role in http realtime worker; do
  echo "$cluster" | grep -q "value: $role\$" || fail "cluster：缺少 APP_ROLES=$role 的 Deployment"
done
echo "$cluster" | grep -q 'DEPLOYMENT_MODE: cluster' || fail "cluster：DEPLOYMENT_MODE 不是 cluster"

# 圖片的 CDN（components/cdn，docs/architecture/backend/09-file.md §16）：兩個 overlay 各疊一次
CDN_DIR=$(mktemp -d "$K8S_DIR/.check-cdn-XXXXXX")
PREFIX=b2b-k8s-cdn-$$
cleanup() {
  docker rm -f "$PREFIX-0" "$PREFIX-1" "$PREFIX-api" >/dev/null 2>&1 || true
  docker network rm "$PREFIX" >/dev/null 2>&1 || true
  docker rmi "$PREFIX-edge" >/dev/null 2>&1 || true
  rm -rf "$CDN_DIR"
}
trap cleanup EXIT
for overlay in standalone cluster; do
  echo "── overlays/$overlay ＋ components/cdn"
  mkdir -p "$CDN_DIR/$overlay"
  printf 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../../overlays/%s\ncomponents:\n  - ../../components/cdn\n' \
    "$overlay" >"$CDN_DIR/$overlay/kustomization.yaml"
  rendered=$(kubectl kustomize "$CDN_DIR/$overlay") || fail "$overlay ＋ cdn：kustomize 產生失敗"
  echo "$rendered" | docker run --rm -i "$KUBECONFORM_IMAGE" -strict -summary \
    -kubernetes-version "$KUBERNETES_VERSION" - || fail "$overlay ＋ cdn：schema 檢查失敗"
  echo "$rendered" | grep -q "FILE_CDN_ENABLED: \"true\"" || fail "$overlay ＋ cdn：api 沒有開啟 FILE_CDN_ENABLED"
  echo "$rendered" | grep -q 'clusterIP: None' || fail "$overlay ＋ cdn：沒有清理用的 headless Service"
  [ "$(echo "$rendered" | grep -c 'name: CDN_PUBLIC_ORIGIN')" = "2" ] || fail "$overlay ＋ cdn：兩個前端都要放行 CDN_PUBLIC_ORIGIN"
done

# ── components/cdn 的 Pod（不起叢集，以 Docker 模擬）
# 規格取自產生出來的 cdn Deployment：沒有這些設定時下面的模擬就不代表 k8s 上的行為，先擋下
echo "── components/cdn 的 Pod（以 Docker 模擬）"
deployment=$(kubectl kustomize "$CDN_DIR/standalone" |
  awk 'BEGIN { RS = "\n---\n" } /kind: Deployment/ && /\n  name: cdn\n/ { print }')
[ -n "$deployment" ] || fail "cdn：找不到 Deployment"
for expected in 'replicas: 2' 'runAsNonRoot: true' 'readOnlyRootFilesystem: true' 'allowPrivilegeEscalation: false' \
  '- ALL' 'mountPath: /tmp' 'mountPath: /var/cache/nginx' 'containerPort: 9080' 'containerPort: 8081' 'name: b2b-cdn-secrets'; do
  echo "$deployment" | grep -qF -- "$expected" || fail "cdn：Deployment 少了 $expected（模擬的前提）"
done
env_value() {
  echo "$deployment" | awk -v name="$1" '$0 ~ "name: " name "$" { getline; sub(/^ *value: */, ""); print; exit }'
}
origin_upstream=$(env_value CDN_ORIGIN_UPSTREAM)
cache_max_size=$(env_value CDN_CACHE_MAX_SIZE)
[ -n "$origin_upstream" ] && [ -n "$cache_max_size" ] || fail "cdn：讀不到 CDN_ORIGIN_UPSTREAM／CDN_CACHE_MAX_SIZE"
api_env=$(kubectl kustomize "$CDN_DIR/standalone" | awk 'BEGIN { RS = "\n---\n" } /kind: ConfigMap/ && /name: b2b-api-env/ { print }')
purge_url=$(echo "$api_env" | awk '$1 == "FILE_CDN_PURGE_URL:" { print $2 }')
[ -n "$purge_url" ] || fail "cdn：api 的 ConfigMap 沒有 FILE_CDN_PURGE_URL"

docker build -q -f "$K8S_DIR/../cdn.Dockerfile" -t "$PREFIX-edge" "$K8S_DIR/../.." >/dev/null
# runAsNonRoot 只接受數字的 USER（名稱時 kubelet 無法確認不是 root，Pod 起不來）
user=$(docker image inspect -f '{{.Config.User}}' "$PREFIX-edge")
case "$user" in
  '' | 0 | *[!0-9]*) fail "cdn：映像的 USER 要是非 0 的數字（runAsNonRoot），實際是「$user」" ;;
esac

# k8s 的 Pod 以 <service>.<namespace>.svc.cluster.local 被找到，容器的 resolv.conf 帶 search domain 與 ndots:5
NAMESPACE_DOMAIN=b2b-system.svc.cluster.local
SIGNING_KEYS="k1:$(openssl rand -base64 48 | tr -d '\n')"
PURGE_SECRET=$(openssl rand -base64 48 | tr -d '\n')
docker network create "$PREFIX" >/dev/null
for replica in 0 1; do
  # 唯讀根目錄、drop ALL、不能提權、emptyDir（/tmp、/var/cache/nginx）、USER 照映像；Secret 以環境變數給（envFrom）。
  # kubelet 建立的 emptyDir 是 0777（Docker 的 tmpfs 預設不是），沒有設 fsGroup 時非 root 的 nginx 靠它寫得進去
  docker run -d --name "$PREFIX-$replica" --network "$PREFIX" \
    --network-alias "cdn.$NAMESPACE_DOMAIN" --network-alias "cdn-purge.$NAMESPACE_DOMAIN" \
    --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:mode=0777 --tmpfs /var/cache/nginx:mode=0777 \
    -e CDN_SIGNING_KEYS="$SIGNING_KEYS" -e CDN_PURGE_SECRET="$PURGE_SECRET" \
    -e CDN_ORIGIN_UPSTREAM="$origin_upstream" -e CDN_CACHE_MAX_SIZE="$cache_max_size" \
    "$PREFIX-edge" >/dev/null
done
# api 的 Pod：以 node 的 dns.lookup 解析 FILE_CDN_PURGE_URL 的短名稱（套 search domain），與 api 的清理相同的做法
docker run -d --name "$PREFIX-api" --network "$PREFIX" --dns-search "$NAMESPACE_DOMAIN" --dns-opt ndots:5 \
  -v "$K8S_DIR/..:/deploy:ro" "$NODE_IMAGE" sleep 300 >/dev/null

# readinessProbe（tcpSocket :9080）：兩個副本都要在時限內就緒（源站是範例的網址、解析不到也要起得來）
for replica in 0 1; do
  ready=
  for _ in $(seq 1 30); do
    if docker exec "$PREFIX-api" node -e "require('net').connect(9080, process.argv[1]).on('connect', () => process.exit(0)).on('error', () => process.exit(1))" \
      "$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PREFIX-$replica")" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [ -n "$ready" ] || { docker logs --tail 30 "$PREFIX-$replica" >&2; fail "cdn：副本 $replica 沒有就緒"; }
done
echo "  ✓ 兩個副本就緒（唯讀根目錄、drop ALL、emptyDir、USER $user）"

# headless Service：短名稱解析到每一個副本，/_status 的簽章檢查在每一個副本都通過
result=$(docker exec "$PREFIX-api" node /deploy/cdn-check.mjs status "$purge_url" "$PURGE_SECRET")
[ "$(echo "$result" | grep -c ' 200 .*"kids":\["k1"\]')" = "2" ] ||
  fail "cdn：$purge_url 要解析到兩個副本、/_status 都回 200 與 kid（$result）"
echo "  ✓ $purge_url 解析到兩個副本，/_status 的簽章檢查都通過"
result=$(docker exec "$PREFIX-api" node /deploy/cdn-check.mjs status "$purge_url" "$PURGE_SECRET" 0 bad)
[ "$(echo "$result" | grep -c ' 403 ')" = "2" ] || fail "cdn：簽章錯的 /_status 要在每個副本被拒（$result）"
echo "  ✓ 簽章錯的 /_status 在每個副本都是 403"

echo "✓ deploy/k8s"
