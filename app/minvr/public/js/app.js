'use strict';

// MiNVR 前端：登录、实时预览（go2rtc 播放页）、米家直连接入、设置
const API = '';
let TOKEN = localStorage.getItem('minvr_token') || '';

function authHeader() {
  return { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
}

async function api(path, opts = {}) {
  opts.headers = Object.assign(authHeader(), opts.headers || {});
  const r = await fetch(API + path, opts);
  if (r.status === 401) {
    logout();
    throw new Error('登录已失效，请重新登录');
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await r.json();
  return { _text: await r.text() };
}

function show(id, v) {
  document.getElementById(id).classList.toggle('hidden', !v);
}

// ---------- 登录 ----------
async function doLogin() {
  const pwd = document.getElementById('pwd').value;
  document.getElementById('loginErr').textContent = '';
  try {
    const j = await fetch(API + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    }).then((r) => r.json());
    if (j.error) throw new Error(j.error);
    TOKEN = j.token;
    localStorage.setItem('minvr_token', TOKEN);
    enterApp();
  } catch (e) {
    document.getElementById('loginErr').textContent = e.message;
  }
}

function logout() {
  TOKEN = '';
  localStorage.removeItem('minvr_token');
  show('app', false);
  show('login', true);
}

function enterApp() {
  show('login', false);
  show('app', true);
  loadLive();
  loadAbout();
}

// ---------- 实时预览 ----------
async function loadLive() {
  const cams = await api('/api/cameras');
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  grid.innerHTML = '';
  if (!cams.length) {
    show('empty', true);
    return;
  }
  show('empty', false);
  for (const c of cams) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const src = encodeURIComponent(c.id);
    tile.innerHTML = `
      <div class="tile-head">
        <span class="tile-name">${esc(c.name)}</span>
        <span class="tile-type">${typeLabel(c.type)}</span>
        <button class="tile-del" data-id="${c.id}">×</button>
      </div>
      <iframe class="tile-video" src="/rtc/stream.html?src=${src}&hls" allow="autoplay; fullscreen" loading="lazy"></iframe>
    `;
    grid.appendChild(tile);
  }
  grid.querySelectorAll('.tile-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('确定删除该摄像头？')) return;
      await api('/api/cameras/' + b.dataset.id, { method: 'DELETE' });
      loadLive();
    })
  );
}

function typeLabel(t) {
  return { rtsp: 'RTSP/ONVIF', xiaomi: '米家', onvif: 'ONVIF', http: 'HTTP' }[t] || t;
}

// ---------- 米家接入 ----------
async function miDiscover() {
  const user = document.getElementById('miUser').value.trim();
  const pass = document.getElementById('miPass').value;
  const status = document.getElementById('miStatus');
  status.textContent = '登录中…';
  status.style.color = '#e67e22';
  try {
    const j = await api('/api/mihome/discover', {
      method: 'POST',
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (j.error) throw new Error(j.error);
    status.textContent = `已找到 ${j.cameras.length} 台摄像头`;
    status.style.color = '#27ae60';
    renderMihomeList(j.cameras);
  } catch (e) {
    status.textContent = e.message;
    status.style.color = '#c0392b';
  }
}

function renderMihomeList(cameras) {
  const box = document.getElementById('miloList');
  if (!cameras.length) {
    box.innerHTML = '<p class="hint">未枚举到摄像头设备（仅显示摄像头类设备）。</p>';
    return;
  }
  box.innerHTML =
    '<p class="hint">勾选要导入的摄像头：</p>' +
    cameras
      .map(
        (c) => `
      <label class="milo-item">
        <input type="checkbox" class="milo-check" value='${esc(JSON.stringify(c))}' />
        <span>${esc(c.name)}</span>
        <span class="muted">${esc(c.model || '')} · ${c.online ? '在线' : '离线'}</span>
      </label>`
      )
      .join('') +
    '<button id="miImport" class="primary">导入选中</button>';
  document.getElementById('miImport').addEventListener('click', () => miImport(box));
}

async function miImport(box) {
  const checks = box.querySelectorAll('.milo-check:checked');
  const acct = await api('/api/mihome/account');
  let n = 0;
  for (const ch of checks) {
    const c = JSON.parse(ch.value);
    await api('/api/cameras', {
      method: 'POST',
      body: JSON.stringify({
        name: c.name,
        type: 'xiaomi',
        username: acct.username,
        password: '', // 密码由后端 mihome 账户提供，这里留空避免重复存储
        did: c.did,
      }),
    });
    n++;
  }
  alert(`已导入 ${n} 台摄像头`);
  loadLive();
}

// ---------- 添加摄像头 ----------
function openAdd() {
  document.getElementById('camErr').textContent = '';
  show('addModal', true);
  toggleCamType();
}
function toggleCamType() {
  const t = document.getElementById('camType').value;
  show('row-source', t === 'rtsp');
  show('row-mi', t === 'xiaomi');
}
async function saveCam() {
  const name = document.getElementById('camName').value.trim();
  const type = document.getElementById('camType').value;
  const err = document.getElementById('camErr');
  if (!name) {
    err.textContent = '请填写名称';
    return;
  }
  const body = { name, type };
  if (type === 'rtsp') {
    body.source = document.getElementById('camSource').value.trim();
    if (!body.source) return (err.textContent = '请填写取流地址');
  } else {
    body.username = document.getElementById('camMiUser').value.trim();
    body.password = document.getElementById('camMiPass').value;
    body.did = document.getElementById('camMiDid').value.trim();
    if (!body.username || !body.password) return (err.textContent = '请填写米家账号与密码');
  }
  body.notes = document.getElementById('camNotes').value.trim();
  try {
    await api('/api/cameras', { method: 'POST', body: JSON.stringify(body) });
    show('addModal', false);
    loadLive();
  } catch (e) {
    err.textContent = e.message;
  }
}

// ---------- 设置 / 关于 ----------
async function loadAbout() {
  const v = await api('/api/version').catch(() => ({}));
  const h = await api('/api/health').catch(() => ({}));
  document.getElementById('about').textContent = JSON.stringify(
    { version: v.version, media: v.media, mediaReady: h.mediaReady, time: h.time },
    null,
    2
  );
  const ms = document.getElementById('mediaStatus');
  ms.textContent = h.mediaReady ? '媒体核心: 就绪' : '媒体核心: 未就绪';
  ms.className = 'badge ' + (h.mediaReady ? 'ok' : 'warn');
  const s = await api('/api/settings').catch(() => ({}));
  document.getElementById('setRecord').checked = !!s.record;
}

async function saveSettings() {
  const rec = document.getElementById('setRecord').checked;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ record: rec }) });
  alert('已保存');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 绑定 ----------
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('pwd').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
document.getElementById('logoutBtn').addEventListener('click', logout);
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
  })
);
document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('camType').addEventListener('change', toggleCamType);
document.getElementById('camCancel').addEventListener('click', () => show('addModal', false));
document.getElementById('camSave').addEventListener('click', saveCam);
document.getElementById('miDiscover').addEventListener('click', miDiscover);
document.getElementById('setSave').addEventListener('click', saveSettings);

// 自动登录
if (TOKEN) enterApp();
