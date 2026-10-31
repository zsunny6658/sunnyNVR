'use strict';

// 集中配置：数据目录与各端口/环境变量。
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data/minvr';
const PORT = parseInt(process.env.PORT || '8080', 10);
const GO2RTC_PORT = parseInt(process.env.GO2RTC_PORT || '1984', 10);
const GO2RTC_BIN = process.env.GO2RTC_BIN || '/usr/local/bin/go2rtc';

// 首次启动默认管理员密码（飞牛安装向导可覆盖 DEFAULT_ADMIN_PASS）
const DEFAULT_ADMIN_PASS = process.env.DEFAULT_ADMIN_PASS || 'admin';

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    /* 运行期再处理 */
  }
}

module.exports = { DATA_DIR, PORT, GO2RTC_PORT, GO2RTC_BIN, DEFAULT_ADMIN_PASS };
