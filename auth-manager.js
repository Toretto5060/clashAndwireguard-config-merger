const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 登录尝试记录文件
const LOGIN_ATTEMPTS_FILE = path.join(__dirname, 'data', 'login-attempts.json');
const MAX_ATTEMPTS = 10; // 最大尝试次数
const LOCK_DURATION = 3 * 60 * 60 * 1000; // 3小时锁定时间（毫秒）

/**
 * 确保数据目录存在
 */
function ensureDataDir() {
  const dataDir = path.dirname(LOGIN_ATTEMPTS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * 读取登录尝试记录
 */
function loadLoginAttempts() {
  try {
    ensureDataDir();
    if (fs.existsSync(LOGIN_ATTEMPTS_FILE)) {
      const data = fs.readFileSync(LOGIN_ATTEMPTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    console.error('读取登录尝试记录失败:', error.message);
    return {};
  }
}

/**
 * 保存登录尝试记录
 */
function saveLoginAttempts(attempts) {
  try {
    ensureDataDir();
    fs.writeFileSync(LOGIN_ATTEMPTS_FILE, JSON.stringify(attempts, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存登录尝试记录失败:', error.message);
  }
}

/**
 * 清理过期的登录尝试记录
 */
function cleanExpiredAttempts(attempts) {
  const now = Date.now();
  const cleaned = {};
  
  for (const [ip, data] of Object.entries(attempts)) {
    // 如果最后尝试时间在3小时内，保留记录
    if (now - data.lastAttempt < LOCK_DURATION) {
      cleaned[ip] = data;
    }
  }
  
  return cleaned;
}

/**
 * 检查IP是否被锁定
 * @param {string} ip - IP地址
 * @returns {object} { locked: boolean, remainingTime: number }
 */
function isIPLocked(ip) {
  const attempts = loadLoginAttempts();
  const ipData = attempts[ip];
  
  if (!ipData) {
    return { locked: false, remainingTime: 0 };
  }
  
  const now = Date.now();
  const timeSinceLastAttempt = now - ipData.lastAttempt;
  
  // 如果超过3小时，解锁
  if (timeSinceLastAttempt >= LOCK_DURATION) {
    return { locked: false, remainingTime: 0 };
  }
  
  // 如果失败次数达到10次，锁定
  if (ipData.failedCount >= MAX_ATTEMPTS) {
    const remainingTime = LOCK_DURATION - timeSinceLastAttempt;
    return { locked: true, remainingTime };
  }
  
  return { locked: false, remainingTime: 0 };
}

/**
 * 记录登录失败
 * @param {string} ip - IP地址
 * @returns {object} 更新后的IP数据
 */
function recordLoginFailure(ip) {
  let attempts = loadLoginAttempts();
  attempts = cleanExpiredAttempts(attempts);
  
  const now = Date.now();
  
  if (!attempts[ip]) {
    attempts[ip] = {
      failedCount: 0,
      lastAttempt: now,
      firstAttempt: now
    };
  }
  
  const timeSinceFirst = now - attempts[ip].firstAttempt;
  
  // 如果距离第一次尝试超过3小时，重置计数
  if (timeSinceFirst >= LOCK_DURATION) {
    attempts[ip] = {
      failedCount: 1,
      lastAttempt: now,
      firstAttempt: now
    };
  } else {
    attempts[ip].failedCount++;
    attempts[ip].lastAttempt = now;
  }
  
  saveLoginAttempts(attempts);
  
  console.log(`登录失败记录 - IP: ${ip}, 失败次数: ${attempts[ip].failedCount}/${MAX_ATTEMPTS}`);
  
  return attempts[ip];
}

/**
 * 清除IP的登录记录（登录成功时）
 * @param {string} ip - IP地址
 */
function clearLoginAttempts(ip) {
  let attempts = loadLoginAttempts();
  delete attempts[ip];
  saveLoginAttempts(attempts);
  
  console.log(`清除登录记录 - IP: ${ip}`);
}

/**
 * 生成session token
 * @returns {string} session token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 验证用户名和密码
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {boolean} 是否验证通过
 */
function verifyCredentials(username, password) {
  const validUsername = process.env.WEB_USERNAME || 'admin';
  const validPassword = process.env.WEB_PASSWORD || 'admin123';
  
  return username === validUsername && password === validPassword;
}

/**
 * 格式化剩余锁定时间
 * @param {number} milliseconds - 毫秒数
 * @returns {string} 格式化的时间字符串
 */
function formatRemainingTime(milliseconds) {
  const hours = Math.floor(milliseconds / (60 * 60 * 1000));
  const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

module.exports = {
  isIPLocked,
  recordLoginFailure,
  clearLoginAttempts,
  generateSessionToken,
  verifyCredentials,
  formatRemainingTime,
  MAX_ATTEMPTS,
  LOCK_DURATION
};

