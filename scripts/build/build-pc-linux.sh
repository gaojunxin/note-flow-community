#!/usr/bin/env bash
# Ubuntu包始终在22.04基线生成；宿主不需要PowerShell，完整门禁仍由标准脚本执行。
set -euo pipefail
usage() {
  cat <<'HELP'
用法：bash scripts/build-pc.sh [--bundles deb|all] [--edition official|community]
在Docker的Ubuntu22.04/amd64环境中构建Linux桌面包；宿主须有Bash及可用Docker。
开发构建默认仅DEB；正式生产使用--bundles all生成全套格式。完整依赖、测试和编译门禁保持。
HELP
}
bundles=deb
edition=official
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --bundles) [[ $# -ge 2 ]] || { echo '--bundles缺少参数' >&2; exit 2; }; bundles=$2; shift 2 ;;
    --edition) [[ $# -ge 2 ]] || { echo '--edition缺少参数' >&2; exit 2; }; edition=$2; shift 2 ;;
    *) echo "不支持的参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$bundles" == all || "$bundles" == deb ]] || { echo 'bundles只支持deb或all' >&2; exit 2; }
[[ "$edition" == official || "$edition" == community ]] || { echo 'edition只支持official或community' >&2; exit 2; }
command -v docker >/dev/null || { echo '请先安装并启动Docker；此Bash入口不要求宿主安装pwsh。' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker不可用，请检查服务和当前用户的访问权限。' >&2; exit 1; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
image=note-flow-ubuntu22-builder:local
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --platform linux/amd64 -t "$image" -f "$repo/scripts/linux/Dockerfile.ubuntu22.04" "$repo/scripts/linux"
fi
# 可显式指定容器可访问的官方 AppImage runtime 文件，避免打包插件再次访问受限网络。
# 不提供时保留工具原有下载行为，不向容器传入空的 runtime 参数。
runtime_args=()
if [[ -n "${LDAI_RUNTIME_FILE:-}" ]]; then
  runtime_args=(-e "LDAI_RUNTIME_FILE=$LDAI_RUNTIME_FILE")
fi
# 只挂载Cargo registry；覆盖整个.cargo会遮住镜像内的Rust工具链。
# 依赖安装会更新工作区node_modules；结束时恢复构建产物/依赖的宿主用户所有权。
exec docker run --rm --init --platform linux/amd64 \
  -v "$repo:/workspace" \
  -v note-flow-pc-cargo-registry:/root/.cargo/registry \
  -v note-flow-pc-build-cache:/root/.cache \
  -v note-flow-pc-npm-cache:/root/.npm \
  "${runtime_args[@]}" \
  -e "NOTEFLOW_BUILD_UID=$(id -u)" -e "NOTEFLOW_BUILD_GID=$(id -g)" \
  -w /workspace "$image" bash -c '
    set -uo pipefail
    version=$(pwsh -NoProfile -Command "(Get-Content version.json -Raw | ConvertFrom-Json).version")
    cleanup() {
      chown -R "$NOTEFLOW_BUILD_UID:$NOTEFLOW_BUILD_GID" \
        "artifacts/pc/$version" artifacts/.build/tauri artifacts/.build/pc-packages \
        node_modules apps/desktop/node_modules packages/core/node_modules \
        apps/desktop/dist apps/desktop/dist-community \
        private/sync-sdk-core/target private/sync-native/target 2>/dev/null || true
    }
    trap cleanup EXIT
    # 独立社区工程没有官方版本装配或Edition参数；在自身根目录只校验已导出的统一版本。
    if [[ -f package.json && -f scripts/check-community-version.mjs ]]; then
      node scripts/check-community-version.mjs || exit $?
      if [[ "$1" == deb ]]; then
        pwsh -NoProfile -File scripts/build-pc.ps1 -Bundles deb -InstallerOnly
      else
        pwsh -NoProfile -File scripts/build-pc.ps1 -Bundles all
      fi
    else
      pwsh -NoProfile -File scripts/sync-version.ps1 || exit $?
      if [[ "$1" == deb ]]; then
        pwsh -NoProfile -File scripts/build-pc.ps1 -Bundles deb -InstallerOnly -Edition "$2"
      else
        pwsh -NoProfile -File scripts/build-pc.ps1 -Bundles all -Edition "$2"
      fi
    fi
  ' noteflow-linux-build "$bundles" "$edition"
