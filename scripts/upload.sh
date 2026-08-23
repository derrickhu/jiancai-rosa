#!/bin/bash
# 一键 CDN 资源上传：扫描 CdnConfig.ts 中的 cdnDirs / cdnPrefixes，增量同步到微信云存储。
# 用法:
#   ./scripts/upload.sh
#   ./scripts/upload.sh --force
#   ./scripts/upload.sh --dry-run

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/upload_cdn.js" "$@"
