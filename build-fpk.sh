#!/bin/bash
# 构建 MiNVR 飞牛 fnOS FPK 安装包
# 用法: ./build-fpk.sh [arch]   默认 arch=x86 （可选 arm64）
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
ARCH="${1:-x86}"
OUT="$ROOT/dist"

# 生成图标（如缺失）
if [ ! -f "$ROOT/ui/images/icon-256.png" ]; then
  python3 "$ROOT/tools/gen_icon.py"
fi
cp "$ROOT/ui/images/icon-256.png" "$ROOT/ICON_256.PNG"
cp "$ROOT/ui/images/icon-64.png"  "$ROOT/ICON.PNG"

# 生命周期脚本可执行
chmod +x "$ROOT/cmd"/* 2>/dev/null || true

# 组装 app.tgz（包含 app/ 与 ui/）
TMPAPP=$(mktemp -d)
cp -r "$ROOT/app" "$TMPAPP/app"
cp -r "$ROOT/ui"  "$TMPAPP/ui"

STAGE=$(mktemp -d)
APPTGZ="$STAGE/app.tgz"
# 排除 node_modules / 锁文件 / 构建产物（镜像内会重新 npm install）
( cd "$TMPAPP" && tar -czf "$APPTGZ" \
    --exclude='app/minvr/node_modules' \
    --exclude='app/minvr/package-lock.json' \
    --exclude='app/minvr/dist' \
    app ui )

# app.tgz 的 md5 写入 manifest.checksum
if command -v md5 >/dev/null 2>&1; then
  MD5=$(md5 -q "$APPTGZ")
else
  MD5=$(md5sum "$APPTGZ" | awk '{print $1}')
fi

# 最终包内容
cp "$ROOT/manifest" "$STAGE/manifest"
if ! grep -q '^checksum=' "$STAGE/manifest"; then
  echo "checksum=$MD5" >> "$STAGE/manifest"
fi
cp -r "$ROOT/cmd"     "$STAGE/"
cp -r "$ROOT/config"  "$STAGE/"
cp -r "$ROOT/wizard"  "$STAGE/"
cp "$ROOT/ICON.PNG"       "$STAGE/ICON.PNG"
cp "$ROOT/ICON_256.PNG"   "$STAGE/ICON_256.PNG"
[ -f "$ROOT/README.md" ] && cp "$ROOT/README.md" "$STAGE/README.md"

mkdir -p "$OUT"
VERSION="$(grep '^version=' "$ROOT/manifest" | head -1 | cut -d= -f2)"
FPK="$OUT/minvr_${VERSION}_${ARCH}.fpk"
( cd "$STAGE" && tar -czf "$FPK" . )

echo "已生成: $FPK"
rm -rf "$STAGE" "$TMPAPP"
