#!/bin/bash
# 使用飞牛官方 fnpack 构建 .fpk 安装包
# 用法: ./build-fpk.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/dist"
FNPACK="$ROOT/tools/fnpack-arm64"
[ -x "$FNPACK" ] || chmod +x "$FNPACK"

# 在干净的临时目录构建，只携带飞牛标准文件（排除 .git/tools/dist）
TMP=$(mktemp -d)
for item in manifest cmd config wizard ICON.PNG ICON_256.PNG; do
  cp -r "$ROOT/$item" "$TMP/" 2>/dev/null || true
done
cp -r "$ROOT/app" "$TMP/"
# 容器内由 Dockerfile 重新 npm install，fpk 不携带 node_modules / 构建产物
rm -rf "$TMP/app/minvr/node_modules" "$TMP/app/minvr/dist" "$TMP/app/minvr/package-lock.json"

cd "$TMP"
"$FNPACK" build -d "$TMP"

mkdir -p "$OUT"
FPK=$(ls "$TMP"/*.fpk 2>/dev/null | head -1)
if [ -n "$FPK" ]; then
  VERSION="$(grep '^version' "$ROOT/manifest" | head -1 | cut -d= -f2 | tr -d ' ')"
  mv "$FPK" "$OUT/minvr_${VERSION}.fpk"
  echo "已生成: $OUT/minvr_${VERSION}.fpk"
else
  echo "未找到构建产物" >&2
  exit 1
fi
rm -rf "$TMP"
