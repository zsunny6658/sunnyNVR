'use strict';

// 米家直连：小米账号登录 + 设备枚举。
// 采用社区标准流程（与 Home Assistant Xiaomi Miot / micloud / python-miio 同源）：
//   1) account.xiaomi.com/pass/serviceLogin  —— 取 qs + _sign
//   2) account.xiaomi.com/pass/serviceLoginAuth2 —— 取 serviceToken / ssecurity / userId / passToken
//   3) api.io.mi.com/home/device_list —— 带签名枚举摄像头
// 拿到 did 后，逐设备交给 go2rtc 的 xiaomi:// 源拉流（见 go2rtc.js）。
//
// 说明：本文件只负责"登录 + 列设备"，不负责拉流/播放，避免重复实现易变协议。
// 该流程依赖小米云端，需真机账号在线验证；若登录/枚举失败，前端仍可手动添加
// "账号+密码(+did)" 的米家摄像头，由 go2rtc 完成登录与拉流。

const crypto = require('crypto');

const ACCOUNT_BASE = 'https://account.xiaomi.com';
const API_BASE = 'https://api.io.mi.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function md5Hex(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function genNonce() {
  return crypto.randomBytes(8).toString('hex');
}

// ssecurity(hex) + nonce(hex) -> signed_nonce(hex)
function signedNonce(ssecurity, nonce) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(ssecurity, 'hex'))
    .update(Buffer.from(nonce, 'hex'))
    .digest('hex');
}

// HMAC-SHA256 对 method&path&params 签名（与 micloud 一致）
function genSignature(urlPath, params, method, signedNonceHex) {
  const arr = [];
  for (const k of Object.keys(params).sort()) arr.push(`${k}=${params[k]}`);
  const paramsStr = arr.join('&');
  const msg = `${method}&${encodeURIComponent(urlPath)}&${encodeURIComponent(paramsStr)}`;
  const sig = crypto
    .createHmac('sha256', Buffer.from(signedNonceHex, 'hex'))
    .update(msg, 'utf8')
    .digest();
  return sig.toString('base64');
}

// 从 serviceLogin 的 JSONP 响应里抠出 {...}
function parseJsonp(text) {
  const m = text.match(/\((\{.*\})\)\s*$/s);
  if (m) return JSON.parse(m[1]);
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function login(username, password) {
  const cookieJar = [];

  // Step 1: serviceLogin 取 qs / _sign
  const s1Url = `${ACCOUNT_BASE}/pass/serviceLogin?_json=true&sid=xiaomiio&qs=${encodeURIComponent(
    '%3Fsid%3Dxiaomiio'
  )}&callback=${encodeURIComponent('https://sts.api.io.mi.com/sts')}`;
  const r1 = await fetch(s1Url, { headers: { 'User-Agent': UA } });
  const t1 = await r1.text();
  // 累加 cookie
  pushCookies(cookieJar, r1.headers.get('set-cookie'));
  const j1 = parseJsonp(t1);
  if (!j1 || !j1._sign) {
    throw new Error('米家登录第一步失败：未取到 _sign（账号或网络异常）');
  }

  // Step 2: serviceLoginAuth2
  const form = new URLSearchParams();
  form.set('user', username);
  form.set('hash', md5Hex(password).toUpperCase());
  form.set('callback', 'https://sts.api.io.mi.com/sts');
  form.set('qs', j1.qs || '%3Fsid%3Dxiaomiio');
  form.set('sid', 'xiaomiio');
  form.set('_sign', j1._sign);
  form.set('_json', 'true');

  const r2 = await fetch(`${ACCOUNT_BASE}/pass/serviceLoginAuth2`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  pushCookies(cookieJar, r2.headers.get('set-cookie'));
  const j2 = parseJsonp(await r2.text());
  if (!j2 || !j2.ssecurity || !j2.serviceToken) {
    const desc = j2 && j2.desc ? j2.desc : '未知错误';
    throw new Error(`米家登录失败：${desc}`);
  }

  return {
    userId: String(j2.userId),
    serviceToken: j2.serviceToken,
    ssecurity: j2.ssecurity,
    passToken: j2.passToken || '',
  };
}

async function deviceList(auth) {
  const nonce = genNonce();
  const sn = signedNonce(auth.ssecurity, nonce);
  const data = JSON.stringify({ getVirtualModel: false, getHuamiDevices: 0 });
  const params = { data };
  const path = '/home/device_list';
  const signature = genSignature(path, params, 'POST', sn);

  const cookie = `userId=${auth.userId};serviceToken=${auth.serviceToken};yetAnotherServiceToken=${auth.serviceToken}`;
  const url = `${API_BASE}${path}?_nonce=${nonce}&signature=${encodeURIComponent(signature)}`;

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP1',
    },
    body: `data=${encodeURIComponent(data)}`,
  });
  const j = await r.json();
  if (j.code !== 0) {
    throw new Error(`设备列表获取失败：code=${j.code} message=${j.message || ''}`);
  }
  return j.result || { list: [] };
}

// 只挑出摄像头类设备（model 含 camera / chuangmi / lumi.camera 等）
function filterCameras(result) {
  const list = (result && result.list) || [];
  const cameras = [];
  for (const d of list) {
    const model = (d.model || '').toLowerCase();
    const name = d.name || d.model || '未命名设备';
    if (
      model.includes('camera') ||
      model.includes('chuangmi') ||
      model.includes('lumi.camera') ||
      model.includes('yhs') ||
      model.includes('imilab')
    ) {
      cameras.push({
        did: String(d.did),
        name,
        model: d.model,
        online: d.isOnline !== 0 && d.online !== false,
      });
    }
  }
  return cameras;
}

function pushCookies(jar, setCookie) {
  if (!setCookie) return;
  const items = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of items) {
    const name = c.split('=')[0];
    const val = c.split(';')[0].slice(name.length + 1);
    const idx = jar.findIndex((x) => x.startsWith(name + '='));
    const entry = `${name}=${val}`;
    if (idx >= 0) jar[idx] = entry;
    else jar.push(entry);
  }
}

// 对外：登录并枚举摄像头，返回 { auth, cameras }
async function discover(username, password) {
  const auth = await login(username, password);
  const result = await deviceList(auth);
  const cameras = filterCameras(result);
  return { auth, cameras };
}

module.exports = { login, deviceList, discover, filterCameras };
