# MiNVR 单容器镜像：Node 管理后端 + go2rtc 媒体核心 + ffmpeg
FROM node:22-slim

ARG TARGETARCH
ARG GO2RTC_VERSION=1.9.9
ENV DEBIAN_FRONTEND=noninteractive

# 系统依赖：ffmpeg 用于按需转码/录像，ca-certificates 用于 HTTPS 出网
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/*

# 安装 go2rtc 静态二进制（按架构下载，内置 xiaomi:// 米家源）
RUN set -eux; \
    arch="${TARGETARCH}"; \
    if [ "$arch" = "amd64" ]; then g2arch="amd64"; fi; \
    if [ "$arch" = "arm64" ]; then g2arch="arm64"; fi; \
    if [ -z "${g2arch:-}" ]; then g2arch="amd64"; fi; \
    curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${g2arch}" \
      -o /usr/local/bin/go2rtc; \
    chmod +x /usr/local/bin/go2rtc; \
    /usr/local/bin/go2rtc --version || true

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

# 数据与配置持久化目录
ENV DATA_DIR=/data
ENV GO2RTC_BIN=/usr/local/bin/go2rtc
ENV GO2RTC_PORT=1984
ENV PORT=8080
EXPOSE 8080
EXPOSE 1984

CMD ["node", "server.js"]
