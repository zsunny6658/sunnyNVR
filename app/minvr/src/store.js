'use strict';

// 简单的 JSON 文件存储：摄像头配置 + 米家账号 + 全局设置。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');

const DB_FILE = path.join(DATA_DIR, 'minvr.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    const init = { cameras: [], mihome: { username: '', password: '' }, settings: { record: false } };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    const bak = DB_FILE + '.bak.' + Date.now();
    try {
      fs.copyFileSync(DB_FILE, bak);
    } catch (_) {}
    const init = { cameras: [], mihome: { username: '', password: '' }, settings: { record: false } };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}

function save(db) {
  ensureDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function newId() {
  return 'cam_' + crypto.randomBytes(4).toString('hex');
}

function listCameras() {
  return load().cameras;
}

function getCamera(id) {
  return load().cameras.find((c) => c.id === id) || null;
}

// 摄像头记录：type 取值 rtsp | onvif | http | xiaomi
function addCamera(cam) {
  const db = load();
  const rec = {
    id: newId(),
    name: cam.name || '未命名摄像头',
    type: cam.type || 'rtsp',
    source: cam.source || '',
    // 米家专用
    username: cam.username || '',
    password: cam.password || '',
    did: cam.did || '',
    enabled: cam.enabled !== false,
    notes: cam.notes || '',
    createdAt: new Date().toISOString(),
  };
  db.cameras.push(rec);
  save(db);
  return rec;
}

function updateCamera(id, patch) {
  const db = load();
  const rec = db.cameras.find((c) => c.id === id);
  if (!rec) return null;
  Object.assign(rec, patch);
  save(db);
  return rec;
}

function deleteCamera(id) {
  const db = load();
  const idx = db.cameras.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  db.cameras.splice(idx, 1);
  save(db);
  return true;
}

// 米家账号（仅存凭据，用于枚举设备；拉流仍由 go2rtc xiaomi:// 完成）
function getMihome() {
  const m = load().mihome || {};
  return { username: m.username || '', password: m.password || '' };
}

function setMihome(cfg) {
  const db = load();
  db.mihome = Object.assign(db.mihome || {}, cfg);
  save(db);
  return db.mihome;
}

function getSettings() {
  return load().settings;
}

function setSettings(patch) {
  const db = load();
  db.settings = Object.assign(db.settings || {}, patch);
  save(db);
  return db.settings;
}

module.exports = {
  listCameras,
  getCamera,
  addCamera,
  updateCamera,
  deleteCamera,
  getMihome,
  setMihome,
  getSettings,
  setSettings,
};
