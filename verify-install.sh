#!/bin/bash
# MiNVR 真机安装验证脚本（在 fnOS 上通过 SSH / 终端运行）
#
# 用法：
#   bash verify-install.sh            # 用默认路径 /var/apps/minvr/target
#   APPDEST=/path/to/app bash verify-install.sh   # 指定安装目录
#   TRIM_APPDEST=/path/to/app bash verify-install.sh
#
# 退出码：0=全部通过，非0=存在失败项。脚本只做只读检查，不修改任何状态。

# 注：不使用 set -u，避免 bash 3.2 在复合分支中对已定义变量误报 unbound。

# ---------- 颜色（SSH 终端可用） ----------
C_OK=$'\033[32m'; C_FAIL=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[90m'; C_RST=$'\033[0m'
ok(){ echo "${C_OK}[PASS]${C_RST} $*"; }
fail(){ echo "${C_FAIL}[FAIL]${C_RST} $*"; FAIL=1; }
warn(){ echo "${C_WARN}[WARN]${C_RST} $*"; }
dim(){ echo "${C_DIM}       $*${C_RST}"; }

FAIL=0

# ---------- 路径解析（与 cmd/main 一致） ----------
APPDEST="${TRIM_APPDEST:-${APPDEST:-/var/apps/minvr/target}}"
COMPOSE_DIR="$APPDEST/docker"
DATA_DIR="/var/apps/minvr/shares/minvr/data"
IMAGE="minvr:0.2.1"
CT="minvr"

echo "========== MiNVR 安装验证 =========="
dim "APPDEST = $APPDEST"
dim "架构    = $(uname -m)"
# WebUI 端口（飞牛应用设置里改了 8080 映射时可覆盖：HPORT=18080 bash verify-install.sh）
HPORT="${HPORT:-8080}"
dim "WebUI端口 = $HPORT"
echo

# ---------- 1. 基础环境 ----------
echo "--- 1. 基础环境 ---"
if command -v docker >/dev/null 2>&1; then
  ok "docker 可用: $(docker --version 2>&1 | head -1)"
else
  fail "未找到 docker，fnOS 应自带；请确认 App Center 环境正常"; echo; exit 1
fi
if docker compose version >/dev/null 2>&1; then dim "docker compose v2 可用"; else warn "docker compose v2 不可用，将回退 v1"; fi
echo

# ---------- 2. 应用目录与镜像 tar ----------
echo "--- 2. FPK 解包内容 ---"
if [ -d "$APPDEST" ]; then
  ok "应用目录存在: $APPDEST"
else
  fail "应用目录不存在: ${APPDEST}（FPK 可能未正确解包）"
fi

ARCH_TAR="minvr_amd64.tar"
case "$(uname -m)" in
  aarch64|arm64) ARCH_TAR="minvr_arm64.tar" ;;
esac
if [ -f "$COMPOSE_DIR/$ARCH_TAR" ]; then
  ok "离线镜像包存在: $COMPOSE_DIR/$ARCH_TAR ($(du -h "$COMPOSE_DIR/$ARCH_TAR" | cut -f1))"
else
  fail "缺少当前架构镜像包: ${COMPOSE_DIR}/${ARCH_TAR}（FPK 不完整或被裁剪）"
fi
if [ -f "$COMPOSE_DIR/docker-compose.yaml" ]; then
  ok "docker-compose.yaml 存在"
else
  fail "缺少 docker-compose.yaml: $COMPOSE_DIR/docker-compose.yaml"
fi
echo

# ---------- 3. 本地镜像 ----------
echo "--- 3. 本地镜像 ---"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  ok "镜像已导入: $IMAGE"
  dim "  $(docker image inspect --format '{{.Size}} bytes, {{.Architecture}}' "$IMAGE" 2>/dev/null)"
else
  fail "镜像 $IMAGE 不存在（install_callback 的 docker load 未生效）"
  dim "  可手动执行: docker load -i $COMPOSE_DIR/$ARCH_TAR"
fi
echo

# ---------- 4. 容器状态 ----------
echo "--- 4. 容器状态 ---"
if docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -q true; then
  ok "容器 $CT 运行中"
  dim "  $(docker inspect -f '{{.State.StartedAt}}' "$CT" 2>/dev/null) 启动"
else
  fail "容器 $CT 未运行"
  dim "  可手动执行: docker compose -f $COMPOSE_DIR/docker-compose.yaml up -d"
  dim "  查看日志: docker logs --tail 50 $CT"
fi
echo

# ---------- 5. WebUI / 后端 ----------
echo "--- 5. WebUI / 后端接口 ---"
if curl -fsS -m 8 "http://localhost:$HPORT/api/health" >/tmp/minvr_health.json 2>/dev/null; then
  ok "GET /api/health -> 200"
  dim "  $(cat /tmp/minvr_health.json)"
  # mediaReady 是关键：go2rtc 是否就绪
  if grep -q '"mediaReady":\s*true' /tmp/minvr_health.json 2>/dev/null; then
    ok "mediaReady = true（go2rtc 已就绪）"
  else
    warn "mediaReady 非 true，媒体核心可能未就绪"
  fi
else
  fail "GET /api/health 无响应（端口 $HPORT 未监听或服务未起）"
fi

if curl -fsS -m 8 -o /dev/null "http://localhost:$HPORT/" 2>/dev/null; then
  ok "GET / (WebUI) -> 200"
else
  fail "WebUI 根路径无响应"
fi
echo

# ---------- 6. go2rtc 媒体核心 ----------
echo "--- 6. go2rtc 媒体核心 (容器内) ---"
if docker exec "$CT" sh -c 'command -v /usr/local/bin/go2rtc' >/dev/null 2>&1; then
  ok "go2rtc 二进制存在"
else
  fail "容器内找不到 go2rtc"
fi
if docker exec "$CT" sh -c '/usr/local/bin/ffmpeg -version >/dev/null 2>&1' 2>/dev/null; then
  ok "ffmpeg 可用（录像/转码依赖）"
else
  fail "容器内 ffmpeg 不可用"
fi
echo

# ---------- 7. 数据卷 ----------
echo "--- 7. 数据目录 ---"
if [ -d "$DATA_DIR" ]; then
  ok "数据目录存在: $DATA_DIR"
  dim "  内容: $(ls -A "$DATA_DIR" 2>/dev/null | tr '\n' ' ')"
else
  warn "数据目录不存在: ${DATA_DIR}（首次启动后应自动创建）"
fi
echo

# ---------- 8. 米家登录（可选，需真实凭证） ----------
echo "--- 8. 米家登录（可选） ---"
if [ -n "${MIHOME_USER:-}" ] && [ -n "${MIHOME_PASS:-}" ]; then
  dim "  用提供的账号测试登录接口..."
  RESP=$(curl -fsS -m 15 -X POST "http://localhost:$HPORT/api/mihome/account" \
    -H 'Content-Type: application/json' \
    -d "{\"user\":\"$MIHOME_USER\",\"pass\":\"$MIHOME_PASS\"}" 2>/dev/null)
  if [ -n "$RESP" ]; then
    ok "米家登录接口返回: $RESP"
  else
    fail "米家登录接口无有效返回（账号/密码/网络/签名逻辑需排查）"
  fi
else
  dim "  未提供 MIHOME_USER / MIHOME_PASS，跳过（可手动在 WebUI 配置）"
fi
echo

# ---------- 结论 ----------
echo "=================================="
if [ "$FAIL" = "0" ]; then
  echo "${C_OK}结论：安装验证通过，MiNVR 应可正常使用。${C_RST}"
  echo "  浏览器访问 http://<NAS_IP>:8080 配置摄像头。"
  exit 0
else
  echo "${C_FAIL}结论：存在失败项，请按上方 [FAIL] 提示逐项排查。${C_RST}"
  echo "  常见排错："
  echo "    - 镜像未导入：手动 docker load -i $COMPOSE_DIR/$ARCH_TAR"
  echo "    - 容器起不来：docker logs --tail 50 $CT"
  echo "    - 端口被占：fnOS 应用设置里改 8080 映射"
  exit 1
fi
