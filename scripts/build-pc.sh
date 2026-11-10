#!/usr/bin/env bash
# Linux入口保持简单，构建实现仍集中在分类目录。
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec bash "$script_dir/build/build-pc-linux.sh" "$@"
