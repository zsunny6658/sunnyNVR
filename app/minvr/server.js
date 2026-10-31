'use strict';

const express = require('express');
const path = require('path');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const config = require('./src/config');
const store = require('./src/store');
const auth = require('./src/auth');
const mihome = require('./src/mihome');
const g2 = require('./src/go2rtc');

const { DATA_DIR, PORT, GO2RTC_PORT } = config;
const APP = express();
APP.use(express.json());

// ---------- 健康检查 / 版本 ----------
APP.get('/api/health', (req, res) =>
  res.json({ status: 'ok', mediaReady: g2.isReady(), time: new Date().toISOString() })
);
APP.get('/api/version', (req, res) => res.json({ name: 'MiNVR', version: '0.2.0', media: 'go2rtc' }));

// ---------- 登录 ----------
APP.post('/api/login', (req, res) => {
  const ok = auth.verifyPassword(req.body && req.body.password);
  if (!ok) return res.status(401).json({ error: '密码错误' });
  res.json({ token: auth.issueToken() });
});

function authMiddleware(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!auth.validToken(token)) return res.status(401).json({ error: '未授权' });
  next();
}

// ---------- 米家账号：登录 + 枚举设备 ----------
APP.post('/api/mihome/discover', authMiddleware, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请填写米家账号与密码' });
  try {
    const { auth: a, cameras } = await mihome.discover(username, password);
    // 持久化账号（用于后续重连/枚举），密码明文存储仅供本机 NAS 使用
    store.setMihome({ username, password });
    res.json({ success: true, userId: a.userId, cameras });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

APP.get('/api/mihome/account', authMiddleware, (req, res) => {
  const m = store.getMihome();
  res.json({ username: m.username, hasPassword: !!m.password });
});

// ---------- 摄像头 CRUD ----------
APP.get('/api/cameras', authMiddleware, (req, res) => {
  res.json(store.listCameras());
});

APP.post('/api/cameras', authMiddleware, async (req, res) => {
  const c = req.body || {};
  if (!c.name) return res.status(400).json({ error: '请填写名称' });
  if (c.type !== 'xiaomi' && !c.source) return res.status(400).json({ error: '请填写取流地址/源' });
  const rec = store.addCamera(c);
  // 加入 go2rtc
  const src = g2.sourceUrl(rec);
  if (src) await g2.addStream(rec.id, src);
  res.json(rec);
});

APP.put('/api/cameras/:id', authMiddleware, async (req, res) => {
  const rec = store.updateCamera(req.params.id, req.body || {});
  if (!rec) return res.status(404).json({ error: '未找到摄像头' });
  const src = g2.sourceUrl(rec);
  if (src) {
    await g2.removeStream(rec.id);
    await g2.addStream(rec.id, src);
  }
  res.json(rec);
});

APP.delete('/api/cameras/:id', authMiddleware, async (req, res) => {
  const ok = store.deleteCamera(req.params.id);
  if (!ok) return res.status(404).json({ error: '未找到摄像头' });
  await g2.removeStream(req.params.id);
  res.json({ success: true });
});

APP.get('/api/cameras/:id/play', authMiddleware, (req, res) => {
  const rec = store.getCamera(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到摄像头' });
  res.json({ id: rec.id, type: rec.type, urls: g2.playUrls(rec.id) });
});

// ---------- 设置 ----------
APP.get('/api/settings', authMiddleware, (req, res) => res.json(store.getSettings()));
APP.post('/api/settings', authMiddleware, (req, res) => res.json(store.setSettings(req.body || {})));

// ---------- 静态前端 ----------
APP.use(express.static(path.join(__dirname, 'public')));

// ---------- go2rtc 反向代理（WebRTC/HLS/MP4/API 同源） ----------
if (g2.GO2RTC_BIN && require('fs').existsSync(g2.GO2RTC_BIN)) {
  APP.use(
    '/rtc',
    createProxyMiddleware({
      target: `http://127.0.0.1:${GO2RTC_PORT}`,
      changeOrigin: true,
      ws: true, // 支持 WebRTC/WebSocket
      pathRewrite: { '^/rtc': '' },
    })
  );
} else {
  APP.use('/rtc', (req, res) =>
    res.status(503).json({ error: '媒体核心 go2rtc 未就绪，请检查容器镜像' })
  );
}

// ---------- 启动 ----------
async function boot() {
  try {
    g2.start();
  } catch (e) {
    console.error('[startup] go2rtc 启动失败，Web 管理仍可用：', e.message);
  }
  APP.listen(PORT, '0.0.0.0', () => {
    console.log(`MiNVR 已启动，监听端口 ${PORT}`);
    // 媒体核心就绪后，把已启用摄像头重新注册
    const wait = setInterval(async () => {
      if (g2.isReady()) {
        clearInterval(wait);
        await g2.syncFromCameras(store.listCameras().filter((c) => c.enabled));
        console.log('[startup] 已恢复摄像头流注册');
      }
    }, 800);
    setTimeout(() => clearInterval(wait), 20000);
  });
}

boot();

module.exports = APP;
