# MiNVR 单容器镜像：Node 管理后端 + go2rtc 媒体核心 + 静态 ffmpeg
# 构建期完全零外网：
#   - go2rtc 静态二进制（宿主预置，按架构 COPY）
#   - 静态 ffmpeg（宿主预置，ffbin/ 下，按架构 COPY，用于转码/录像）
#   - node_modules（宿主 npm install 预置，纯 JS 跨平台）
# 唯一外部依赖为基础镜像 node:22-slim（已预拉取）
FROM node:22-slim

ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive

# 静态 ffmpeg（预下载，构建期零外网；用于按需转码/录像）
COPY ffbin/ffmpeg_linux_${TARGETARCH} /usr/local/bin/ffmpeg
RUN chmod +x /usr/local/bin/ffmpeg && (/usr/local/bin/ffmpeg -version 2>/dev/null | head -1 || true)

# 预置的 go2rtc 静态二进制（按架构拷贝，内置 xiaomi:// 米家源）
COPY go2rtc_linux_${TARGETARCH} /usr/local/bin/go2rtc
RUN chmod +x /usr/local/bin/go2rtc && (/usr/local/bin/go2rtc --version || true)

WORKDIR /app

# 生产依赖（宿主预装，express/http-proxy-middleware 均为纯 JS，跨平台可用）
COPY package.json ./
COPY node_modules ./node_modules

COPY server.js ./
COPY src ./src
COPY public ./public

# 数据与配置持久化目录
ENV DATA_DIR=/data
ENV GO2RTC_BIN=/usr/local/bin/go2rtc
ENV FFMPEG_BIN=/usr/local/bin/ffmpeg
ENV GO2RTC_PORT=1984
ENV PORT=8080
EXPOSE 8080
EXPOSE 1984

CMD ["node", "server.js"]
