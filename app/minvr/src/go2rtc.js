'use strict';

// go2rtc 媒体核心封装：启动进程、动态增删 stream、健康检查、播放地址构造。
// 米家直连由 go2rtc 内置的 xiaomi:// 源完成（账号密码/did），无需 miloco 桥接。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DATA_DIR } = require('./config');

const GO2RTC_PORT = parseInt(process.env.GO2RTC_PORT || '1984', 10);
const GO2RTC_BIN = process.env.GO2RTC_BIN || '/usr/local/bin/go2rtc';

let proc = null;
let ready = false;

function cfgPath() {
  return path.join(DATA_DIR, 'go2rtc.yaml');
}

// 基础配置：只开 api（播放/管理），具体 stream 由 MiNVR 运行时写入文件 + API 增量添加
function writeBaseConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const cfg = [
    'api:',
    `  listen: ":${GO2RTC_PORT}"`,
    '  origin: "*"',
    '  base_path: ""',
    'log:',
    '  level: info',
    'streams: {}',
    '',
  ].join('\n');
  fs.writeFileSync(cfgPath(), cfg);
}

function start() {
  writeBaseConfig();
  if (!fs.existsSync(GO2RTC_BIN)) {
    console.warn('[go2rtc] 二进制未找到：', GO2RTC_BIN, '—— 拉流/播放功能不可用，Web 管理仍正常。');
    return;
  }
  try {
    proc = spawn(GO2RTC_BIN, ['-config', cfgPath()], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('exit', (code) => {
      ready = false;
      console.warn('[go2rtc] 进程退出，code=', code);
    });
    proc.on('error', (e) => {
      ready = false;
      console.error('[go2rtc] 启动失败：', e.message);
    });
    // 轮询直到 API 可用
    const t = setInterval(async () => {
      if (await reachable()) {
        ready = true;
        clearInterval(t);
        console.log('[go2rtc] API 就绪，端口', GO2RTC_PORT);
      }
    }, 500);
    setTimeout(() => clearInterval(t), 15000);
  } catch (e) {
    console.error('[go2rtc] spawn 异常：', e.message);
  }
}

function apiRequest(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: GO2RTC_PORT,
        path: pathStr,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          try {
            resolve(s ? JSON.parse(s) : {});
          } catch (e) {
            resolve({});
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function reachable() {
  try {
    await apiRequest('GET', '/api/streams');
    return true;
  } catch (e) {
    return false;
  }
}

async function addStream(name, url) {
  if (!(await reachable())) return false;
  try {
    await apiRequest('POST', '/api/streams', { name, url });
    return true;
  } catch (e) {
    console.error('[go2rtc] addStream 失败', name, e.message);
    return false;
  }
}

async function removeStream(name) {
  if (!(await reachable())) return false;
  try {
    await apiRequest('DELETE', `/api/streams/${encodeURIComponent(name)}`);
    return true;
  } catch (e) {
    return false;
  }
}

async function listStreams() {
  try {
    return await apiRequest('GET', '/api/streams');
  } catch (e) {
    return {};
  }
}

// 把摄像头列表重建为 go2rtc streams（用于服务启动后批量恢复）
async function syncFromCameras(cameras) {
  if (!(await reachable())) return;
  for (const c of cameras) {
    const src = sourceUrl(c);
    if (src) await addStream(c.id, src);
  }
}

// 摄像头 -> go2rtc 源 URL
function sourceUrl(c) {
  if (!c) return null;
  if (c.type === 'xiaomi') {
    // go2rtc xiaomi://username:password 或 xiaomi://username:password/did
    const base = `xiaomi://${c.username || ''}:${c.password || ''}`;
    return c.did ? `${base}/${c.did}` : base;
  }
  return c.source || null;
}

// 前端播放地址（WHEP WebRTC 优先，HLS 兜底，全部同源经后端反代）
function playUrls(id) {
  const base = `/rtc`;
  return {
    webrtc: `${base}/api/webrtc`,
    hls: `${base}/api/stream.m3u8?src=${encodeURIComponent(id)}`,
    mp4: `${base}/api/stream.mp4?src=${encodeURIComponent(id)}`,
  };
}

module.exports = {
  start,
  addStream,
  removeStream,
  listStreams,
  reachable,
  syncFromCameras,
  sourceUrl,
  playUrls,
  GO2RTC_PORT,
  isReady: () => ready,
};
