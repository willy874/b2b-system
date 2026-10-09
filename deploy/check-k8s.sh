#!/usr/bin/env sh
# k8s 的參考部署（deploy/k8s，docs/architecture/01-system.md §7 D15）：兩個 overlay 都要能以 kustomize 產生，
# 並通過 Kubernetes 的 schema 檢查（kubeconform，strict：拼錯的欄位也算錯）。需要 kubectl（內建 kustomize）與 Docker。
# 不起叢集：探針、角色與排空的行為由 api 的測試與 deploy/smoke-test.sh --cluster 驗證。
#
# 用法：sh deploy/check-k8s.sh
set -eu

K8S_DIR=$(cd "$(dirname "$0")/k8s" && pwd)
KUBECONFORM_IMAGE=ghcr.io/yannh/kubeconform:v0.7.0@sha256:85dbef6b4b312b99133decc9c6fc9495e9fc5f92293d4ff3b7e1b30f5611823c
# 與 CI 的 runner 上常見的叢集版本相近；schema 取自 kubeconform 的預設來源
KUBERNETES_VERSION=1.33.0

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
trap 'rm -rf "$CDN_DIR"' EXIT
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
echo "✓ deploy/k8s"
