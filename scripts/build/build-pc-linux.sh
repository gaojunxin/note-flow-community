#!/usr/bin/env bash
# Ubuntu包始终在22.04基线生成；宿主不需要PowerShell，完整门禁仍由标准脚本执行。
set -euo pipefail
usage() {
  cat <<'HELP'
用法：bash scripts/build-pc.sh [--bundles all] [--edition official|community]
在Docker的Ubuntu22.04/amd64环境中构建Linux桌面包；宿主须有Bash及可用Docker。
默认all同时交付DEB/AppImage；首次运行可能构建工具链镜像并下载依赖。
HELP
}
bundles=all
edition=official
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --bundles) [[ $# -ge 2 ]] || { echo '--bundles缺少参数' >&2; exit 2; }; bundles=$2; shift 2 ;;
    --edition) [[ $# -ge 2 ]] || { echo '--edition缺少参数' >&2; exit 2; }; edition=$2; shift 2 ;;
    *) echo "不支持的参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$bundles" == all ]] || { echo '此入口要求--bundles all，以同时交付安装包和免安装包。' >&2; exit 2; }
[[ "$edition" == official || "$edition" == community ]] || { echo 'edition只支持official或community' >&2; exit 2; }
command -v docker >/dev/null || { echo '请先安装并启动Docker；此Bash入口不要求宿主安装pwsh。' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker不可用，请检查服务和当前用户的访问权限。' >&2; exit 1; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
image=note-flow-ubuntu22-builder:local
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --platform linux/amd64 -t "$image" -f "$repo/scripts/linux/Dockerfile.ubuntu22.04" "$repo/scripts/linux"
fi
# 只挂载Cargo registry；覆盖整个.cargo会遮住镜像内的Rust工具链。
# 依赖安装会更新工作区node_modules；结束时恢复构建产物/依赖的宿主用户所有权。
exec docker run --rm --init --platform linux/amd64 \
  -v "$repo:/workspace" \
  -v note-flow-pc-cargo-registry:/root/.cargo/registry \
  -v note-flow-pc-build-cache:/root/.cache \
  -v note-flow-pc-npm-cache:/root/.npm \
  -e "NOTEFLOW_BUILD_UID=$(id -u)" -e "NOTEFLOW_BUILD_GID=$(id -g)" \
  -w /workspace "$image" bash -c '
    set -uo pipefail
    version=$(pwsh -NoProfile -Command "(Get-Content version.json -Raw | ConvertFrom-Json).version")
    cleanup() {
      chown -R "$NOTEFLOW_BUILD_UID:$NOTEFLOW_BUILD_GID" \
        "artifacts/pc/$version" artifacts/.build/tauri artifacts/.build/pc-packages \
        apps/desktop/node_modules packages/core/node_modules \
        apps/desktop/dist apps/desktop/dist-community 2>/dev/null || true
    }
    trap cleanup EXIT
    pwsh -NoProfile -File scripts/sync-version.ps1 || exit $?
    pwsh -NoProfile -File scripts/build-pc.ps1 -Bundles "$1" -Edition "$2"
  ' noteflow-linux-build "$bundles" "$edition"
