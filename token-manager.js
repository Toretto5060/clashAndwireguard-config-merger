const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Token文件路径
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(__dirname, 'data', 'tokens.json');

/**
 * 生成短token
 * @returns {string} 8位随机字符串
 */
function generateToken() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * 确保token文件目录存在
 */
function ensureTokenDir() {
  const tokenDir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }
}

/**
 * 读取所有token
 * @returns {Array} token列表
 */
function loadTokens() {
  try {
    ensureTokenDir();
    
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('读取token文件失败:', error.message);
    return [];
  }
}

/**
 * 保存token列表
 * @param {Array} tokens - token列表
 */
function saveTokens(tokens) {
  try {
    ensureTokenDir();
    const data = JSON.stringify(tokens, null, 2);
    fs.writeFileSync(TOKEN_FILE, data, 'utf-8');
    return true;
  } catch (error) {
    console.error('保存token文件失败:', error.message);
    return false;
  }
}

/**
 * 创建新token
 * @param {string} configName - 配置文件名
 * @returns {object|null} 新创建的token对象，如果已存在则返回null
 */
function createToken(configName) {
  const tokens = loadTokens();
  
  // 检查是否已有有效的token
  const existing = tokens.find(t => t.configName === configName && t.active);
  if (existing) {
    return null; // 已存在有效token
  }
  
  const token = generateToken();
  const tokenObj = {
    token: token,
    configName: configName,
    active: true,
    createdAt: Date.now(), // 使用时间戳而不是ISO字符串
    lastUsed: null,
    usageCount: 0
  };
  
  tokens.push(tokenObj);
  saveTokens(tokens);
  
  console.log(`创建token: ${token} for ${configName}`);
  return tokenObj;
}

/**
 * 验证token
 * @param {string} token - token字符串
 * @returns {object|null} token对象，如果无效返回null
 */
function validateToken(token) {
  const tokens = loadTokens();
  const tokenObj = tokens.find(t => t.token === token && t.active);
  
  if (tokenObj) {
    // 更新使用信息
    tokenObj.lastUsed = Date.now(); // 使用时间戳
    tokenObj.usageCount++;
    saveTokens(tokens);
  }
  
  return tokenObj;
}

/**
 * 失效token
 * @param {string} token - token字符串
 * @returns {boolean} 是否成功失效
 */
function revokeToken(token) {
  const tokens = loadTokens();
  const tokenObj = tokens.find(t => t.token === token);
  
  if (tokenObj) {
    tokenObj.active = false;
    tokenObj.revokedAt = Date.now(); // 使用时间戳
    saveTokens(tokens);
    console.log(`Token已失效: ${token}`);
    return true;
  }
  
  return false;
}

/**
 * 删除token记录（从文件中彻底移除）
 * @param {string} token - token字符串
 * @returns {boolean} 是否删除成功
 */
function removeToken(token) {
  const tokens = loadTokens();
  const index = tokens.findIndex(t => t.token === token);
  if (index === -1) {
    return false;
  }
  tokens.splice(index, 1);
  saveTokens(tokens);
  console.log(`Token记录已删除: ${token}`);
  return true;
}

/**
 * 获取配置的token
 * @param {string} configName - 配置文件名
 * @returns {object|null} token对象
 */
function getTokenByConfig(configName) {
  const tokens = loadTokens();
  return tokens.find(t => t.configName === configName && t.active);
}

/**
 * 获取所有token
 * @returns {Array} token列表
 */
function getAllTokens() {
  return loadTokens();
}

module.exports = {
  createToken,
  validateToken,
  revokeToken,
  removeToken,
  getTokenByConfig,
  getAllTokens
};

