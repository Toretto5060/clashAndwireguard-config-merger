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
    usageCount: 0,
    /** 是否合并左侧「路由规则」；缺省为 true（兼容旧数据） */
    useRules: true,
    /** 是否注入 WireGuard 节点与左侧代理组；缺省为 true */
    useWireGuard: true
  };
  
  tokens.push(tokenObj);
  saveTokens(tokens);
  
  console.log(`创建token: ${token} for ${configName}`);
  return tokenObj;
}

/**
 * 按 token 字符串查找记录（含已失效），用于区分「已删除」与「仅失效」
 */
function getTokenRecord(token) {
  const tokens = loadTokens();
  return tokens.find(t => t.token === token) || null;
}

/**
 * 有效订阅被拉取时更新使用统计（须在已确认 active 后调用）
 */
function incrementTokenUsage(token) {
  const tokens = loadTokens();
  const tokenObj = tokens.find(t => t.token === token && t.active);
  if (!tokenObj) {
    return false;
  }
  tokenObj.lastUsed = Date.now();
  tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
  return saveTokens(tokens);
}

/**
 * 已失效的订阅被客户端拉取空白模板后标记，便于管理端确认本地配置已被覆盖
 */
function markBlankTemplateServedAfterRevoke(tokenStr) {
  const tokens = loadTokens();
  const t = tokens.find(x => x.token === tokenStr);
  if (!t || t.active !== false) {
    return false;
  }
  if (t.blankServedAfterRevoke) {
    return true;
  }
  t.blankServedAfterRevoke = true;
  t.blankServedAfterRevokeAt = Date.now();
  return saveTokens(tokens);
}

/**
 * 验证token（仅有效 token 返回对象并刷新使用统计；失效/不存在返回 null）
 * @param {string} token - token字符串
 * @returns {object|null} token对象，如果无效返回null
 */
function validateToken(token) {
  const tokens = loadTokens();
  const tokenObj = tokens.find(t => t.token === token && t.active);

  if (tokenObj) {
    tokenObj.lastUsed = Date.now();
    tokenObj.usageCount = (tokenObj.usageCount || 0) + 1;
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
    delete tokenObj.blankServedAfterRevoke;
    delete tokenObj.blankServedAfterRevokeAt;
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
 * 更新订阅 token 的合并选项（路由规则 / WireGuard）
 * @param {string} tokenStr
 * @param {{ useRules?: boolean, useWireGuard?: boolean }} opts
 * @returns {object|null} 更新后的 token 对象，失败返回 null
 */
function updateTokenOptions(tokenStr, opts) {
  const tokens = loadTokens();
  const tokenObj = tokens.find(t => t.token === tokenStr);
  if (!tokenObj) {
    return null;
  }
  if (typeof opts.useRules === 'boolean') {
    tokenObj.useRules = opts.useRules;
  }
  if (typeof opts.useWireGuard === 'boolean') {
    tokenObj.useWireGuard = opts.useWireGuard;
  }
  if (!saveTokens(tokens)) {
    return null;
  }
  return tokenObj;
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
  getTokenRecord,
  incrementTokenUsage,
  markBlankTemplateServedAfterRevoke,
  revokeToken,
  removeToken,
  updateTokenOptions,
  getTokenByConfig,
  getAllTokens
};

