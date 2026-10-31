# MiNVR · 米家摄像头直连接入平台

一个面向飞牛 fnOS 的轻量 NVR 平台，对标 minvr / mibeenvr / EasyNVR：把分布在各处的摄像头（**米家摄像头账号直连**、以及任意 **RTSP / ONVIF** 摄像头）统一接入，通过浏览器实时预览、按需录像。

> 版本：0.2.0（米家直连接入，无需 miloco 桥接）。

## 核心能力

- **米家直连**：在「米家接入」页填写米家（小米）账号与密码，登录后自动枚举账号下的摄像头，勾选一键导入。拉流由内置 **go2rtc** 的 `xiaomi://` 源完成，**无需额外部署 miloco 或桥接容器**。
- **通用 RTSP / ONVIF**：任何暴露 RTSP 的摄像头（Aqara 原生 RTSP、海康、大华、ONVIF 设备等）直接填地址即可。
- **Web 实时预览**：内置 go2rtc 播放页，浏览器自动协商 WebRTC → MSE → HLS → MP4，无需插件、完全离线。
- **按需录像**：可开启录像，文件落在数据卷 `/data/recordings`。
- **单容器交付**：后端 + go2rtc 媒体核心 + ffmpeg 打包进同一个镜像，对外只暴露一个 Web 端口，部署简单。

## 架构

```
浏览器(go2rtc 播放页: WebRTC/MSE/HLS/MP4 自动降级)
   │  http://<飞牛IP>:<端口>/
   ▼
MiNVR 容器（单容器）
   ├─ Node 管理后端 (Express)   :8080  提供 Web UI / API / 反向代理(/rtc)
   ├─ go2rtc 媒体核心           :1984  xiaomi:// 米家源 + 多协议输出
   └─ ffmpeg（按需转码/录像）
        ▲
        │ 拉流（xiaomi:// / RTSP / ONVIF / HTTP）
        ▼
   米家云 ⇄ 米家摄像头   或   任意 RTSP/ONVIF 摄像头
```

## 在飞牛上安装

1. 在飞牛「应用中心 → 手动安装」选择生成的 `minvr_0.2.0_x86.fpk`（ARM 设备选 `arm64` 版本）。
2. 安装向导设置：管理员密码（默认 `admin`）。米家账号在「米家接入」页内填写。
3. 安装完成后，桌面「MiNVR」图标打开 Web 管理后台；默认密码即上面设置的（默认 admin/admin）。

> 首次启动会拉取/构建镜像并下载 go2rtc，请等待「媒体核心: 就绪」变为绿色后再使用预览。

## 米家摄像头接入步骤（重点）

绝大多数米家摄像头**不原生开放 RTSP**（Aqara 部分型号除外），但可以通过米家账号授权 + go2rtc 内置 `xiaomi://` 源**直连**拉流，无需 miloco：

1. 打开 MiNVR Web 后台，切到「**米家接入**」页。
2. 填写你的**米家（小米）账号与密码** → 点「登录并获取摄像头列表」。
   - 平台会走小米账号标准登录流程，枚举该账号下的摄像头设备。
   - 仅列出摄像头类设备（model 含 camera / chuangmi / lumi.camera 等）。
3. 勾选要接入的摄像头 → 「导入选中」，即在「实时预览」出现画面。

> 也可在「实时预览 → 添加摄像头」中，类型选「米家直连（账号密码）」，手工填账号/DID。DID 留空时由 go2rtc 自动处理账号下设备。

### 关于"扫码接入"的说明（重要）

- 小米**官方 OAuth 扫码**需要**企业开发者资质**，个人/家庭用户拿不到，本平台与个人 NVR 一样走**账号密码登录**（社区标准 `account.xiaomi.com` 流程，与 Home Assistant Xiaomi Miot、micloud 同源）。
- 体验上等同于"输入米家账号即可接入"，不需要你再去部署任何桥接服务。

## 配置说明

| 环境变量 | 说明 | 默认 |
|---|---|---|
| `ADMIN_PASSWORD` | Web 后台管理员密码 | `admin` |
| `GO2RTC_BIN` | go2rtc 二进制路径 | `/usr/local/bin/go2rtc` |
| `GO2RTC_PORT` | go2rtc 监听端口 | `1984` |
| `TRIM_SERVICE_PORT` | 由飞牛注入的 Web 端口 | `8080` |

数据持久化目录：`<飞牛应用数据卷>/data`（含 `minvr.json` 配置、`go2rtc.yaml`、`recordings/` 录像）。

## 本地构建 FPK

```bash
cd minvr
chmod +x build-fpk.sh
./build-fpk.sh x86      # 或 ./build-fpk.sh arm64
# 产物: dist/minvr_0.2.0_x86.fpk
```

## 目录结构

```
minvr/
├── manifest                 # 飞牛应用元数据 (INI)
├── app/
│   ├── docker/docker-compose.yaml
│   └── minvr/               # Node 应用源码
│       ├── server.js
│       ├── src/{store,go2rtc,mihome,auth,config}.js
│       ├── public/          # 前端
│       ├── package.json
│       └── Dockerfile
├── cmd/                     # 生命周期脚本
├── config/                  # privilege / resource
├── wizard/install           # 安装向导
├── ui/                      # 桌面入口 + 图标
├── ICON.PNG / ICON_256.PNG
├── tools/gen_icon.py
└── build-fpk.sh
```

## 已知限制（0.2.0）

- 米家登录/枚举的签名流程依赖小米云端，已按社区标准实现，需**真机账号在线验证**；若枚举失败，仍可用「添加摄像头 → 米家直连」手填账号/DID 让 go2rtc 拉流。
- 多摄像头同时 WebRTC 预览对 NAS 性能有要求；默认播放页走 HLS 更稳。
- 未经过真实飞牛硬件端到端验证；FPK 结构遵循公开开发文档，安装前建议在测试机验证。
- 录像检索为 go2rtc 原生能力，Web 端仅做开关与落盘，回放点播后续版本增强。
