const express = require('express');
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const yaml = require('js-yaml');
const { loadAllWireGuardConfigs, convertToClashProxy } = require('./wireguard-parser');
const {
  fetchAndMergeConfigs,
  appendMultipleWireGuardProfiles,
  createEmptyConfig
} = require('./config-merger');
const { readStaleRemoteCache, writeRemoteCacheSuccess } = require('./remote-subscription-cache');
const { loadConfig, saveConfig, validateConfig } = require('./config-manager');
const {
  createToken,
  getTokenRecord,
  incrementTokenUsage,
  markBlankTemplateServedAfterRevoke,
  revokeToken,
  removeToken,
  updateTokenOptions,
  getTokenByConfig,
  getAllTokens
} = require('./token-manager');
const { 
  isIPLocked, 
  recordLoginFailure, 
  clearLoginAttempts, 
  generateSessionToken, 
  verifyCredentials,
  formatRemainingTime 
} = require('./auth-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const CONF_DIR = process.env.CONF_DIR || path.join(__dirname, 'conf');
const SCRIPT_DIR = process.env.SCRIPT_DIR || path.join(__dirname, 'script');

function validateWgClientName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name) && name.length >= 1 && name.length <= 64;
}

function runWgScript(scriptBase, args, res) {
  const scriptPath = path.join(SCRIPT_DIR, scriptBase);
  if (!fs.existsSync(scriptPath)) {
    return res.status(503).json({
      success: false,
      error: `脚本不存在: ${scriptPath}（请挂载 SCRIPT_DIR 或将脚本放入 script 目录）`
    });
  }
  execFile('/bin/sh', [scriptPath, ...args], {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  }, (err, stdout, stderr) => {
    const code = err && typeof err.code === 'number' ? err.code : 0;
    const success = code === 0;
    res.status(success ? 200 : 500).json({
      success,
      exitCode: code,
      stdout: (stdout || '').toString(),
      stderr: (stderr || '').toString(),
      error: success ? undefined : (err && err.message ? err.message : '脚本退出码非 0')
    });
  });
}

// Session存储（内存中）
const sessions = new Map();

// 获取客户端IP地址
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress;
}

// 认证中间件
function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || 
                req.query.token;
  
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized', message: '请先登录' });
  }
  
  const session = sessions.get(token);
  const now = Date.now();
  
  // Session有效期24小时
  if (now - session.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized', message: '登录已过期，请重新登录' });
  }
  
  // 更新最后活动时间
  session.lastActivity = now;
  
  next();
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 从配置文件加载配置
let appConfig = loadConfig();

// 在启动时加载所有 WireGuard 配置
let wireguardConfigs = {};

/**
 * 重新排序配置对象的键，确保 proxies、proxy-groups、rules 在最后
 * 保持原配置中其他字段的原有顺序
 */
function reorderConfigKeys(config) {
  const ordered = {};
  const keyFields = ['proxies', 'proxy-groups', 'rules'];
  
  // 先添加所有非关键字段（保持原有顺序）
  Object.keys(config).forEach(key => {
    if (!keyFields.includes(key)) {
      ordered[key] = config[key];
    }
  });
  
  // 最后按顺序添加关键字段
  keyFields.forEach(key => {
    if (config.hasOwnProperty(key)) {
      ordered[key] = config[key];
    }
  });
  
  return ordered;
}

/**
 * 生成空的配置模板
 */
function generateEmptyConfigTemplate() {
  return {
    port: 7890,
    'socks-port': 7891,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    proxies: [],
    'proxy-groups': [
      {
        name: '🚀 订阅已过期',
        type: 'select',
        proxies: ['DIRECT']
      }
    ],
    rules: [
      'MATCH,🚀 订阅已过期'
    ]
  };
}

/**
 * 格式化订阅信息为响应头格式（使用原始字节数和时间戳）
 */
function formatSubscriptionHeader(info) {
  const parts = [];
  
  // 使用原始字节数，不是格式化后的字符串
  if (info.upload !== undefined) parts.push(`upload=${info.upload}`);
  if (info.download !== undefined) parts.push(`download=${info.download}`);
  if (info.total !== undefined) parts.push(`total=${info.total}`);
  if (info.expire !== undefined) parts.push(`expire=${info.expire}`);
  
  return parts.join('; ');
}

/** 与左侧 Web 订阅源脱敏规则一致（中间打星） */
function maskSubscriptionUrlForComment(url) {
  if (!url || typeof url !== 'string') return url || '';
  if (url.length < 20) return url;
  const protocolEnd = url.indexOf('://');
  if (protocolEnd === -1) {
    if (url.length <= 10) return url;
    const a = url.slice(0, 5);
    const b = url.slice(-5);
    return `${a}${'*'.repeat(Math.min(30, url.length - 10))}${b}`;
  }
  const protocol = url.slice(0, protocolEnd + 3);
  const rest = url.slice(protocolEnd + 3);
  if (rest.length <= 10) return url;
  const visibleStart = rest.slice(0, 5);
  const visibleEnd = rest.slice(-5);
  return `${protocol}${visibleStart}${'*'.repeat(Math.min(30, rest.length - 10))}${visibleEnd}`;
}

function formatZhCommentTime(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * 生成订阅信息 YAML 注释（含拉取状态、时间、打码 URL）
 * @param {Array} allSubscriptionInfos
 * @param {{ remoteFetchOk: boolean, usedStaleRemote: boolean, subscriptionDataUpdatedAt: number|null, lastAttemptAt: number }} meta
 */
function generateAllSubscriptionComment(allSubscriptionInfos, meta) {
  const lines = [];
  const {
    remoteFetchOk,
    usedStaleRemote,
    subscriptionDataUpdatedAt,
    lastAttemptAt
  } = meta;

  lines.push('# ========================================');
  lines.push('# 订阅信息');
  lines.push('# ========================================');

  if (remoteFetchOk) {
    lines.push('# 远程订阅拉取: 成功');
  } else if (usedStaleRemote) {
    lines.push('# 远程订阅拉取: 失败（已使用上次成功拉取的订阅合并结果）');
  } else {
    lines.push('# 远程订阅拉取: 失败（无可用缓存）');
  }

  if (subscriptionDataUpdatedAt != null) {
    const suffix =
      !remoteFetchOk && usedStaleRemote ? '（本次拉取失败，未更新）' : '';
    lines.push(`# 订阅源数据更新时间: ${formatZhCommentTime(subscriptionDataUpdatedAt)}${suffix}`);
  } else {
    lines.push('# 订阅源数据更新时间: —');
  }

  lines.push(`# 最近拉取尝试: ${formatZhCommentTime(lastAttemptAt)}`);

  (allSubscriptionInfos || []).forEach((info, index) => {
    const masked = maskSubscriptionUrlForComment(info.url);
    lines.push(`# 订阅源 ${index + 1}: ${masked}`);

    if (info.uploadFormatted) lines.push(`#   上传流量: ${info.uploadFormatted}`);
    if (info.downloadFormatted) lines.push(`#   下载流量: ${info.downloadFormatted}`);
    if (info.usedFormatted) lines.push(`#   已用流量: ${info.usedFormatted}`);
    if (info.totalFormatted) lines.push(`#   总流量: ${info.totalFormatted}`);
    if (info.remainingFormatted) lines.push(`#   剩余流量: ${info.remainingFormatted}`);
    if (info.expireFormatted) lines.push(`#   到期时间: ${info.expireFormatted}`);

    if (index < (allSubscriptionInfos || []).length - 1) {
      lines.push('#   ---');
    }
  });

  lines.push('# ========================================');
  lines.push('');

  return lines.join('\n');
}

function loadConfigs() {
  console.log('\n========================================');
  console.log('正在加载 WireGuard 配置...');
  console.log('配置目录:', CONF_DIR);
  console.log('========================================\n');
  
  wireguardConfigs = loadAllWireGuardConfigs(CONF_DIR);
  
  console.log('\n========================================');
  console.log(`已加载 ${Object.keys(wireguardConfigs).length} 个 WireGuard 配置`);
  console.log('配置列表:', Object.keys(wireguardConfigs).join(', '));
  console.log('========================================\n');
  
  // 检查并失效不存在配置的订阅token
  const availableConfigs = Object.keys(wireguardConfigs);
  const allTokens = getAllTokens();
  let revokedCount = 0;
  
  allTokens.forEach(token => {
    if (!availableConfigs.includes(token.configName)) {
      console.log(`⚠️ 配置 "${token.configName}" 不存在，自动失效token: ${token.token}`);
      revokeToken(token.token);
      revokedCount++;
    }
  });
  
  if (revokedCount > 0) {
    console.log(`✓ 已自动失效 ${revokedCount} 个无效订阅\n`);
  }
}

// 初始加载配置
loadConfigs();

// 中间件：日志
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ==================== 认证API ====================

// 检查IP锁定状态
app.get('/api/auth/status', (req, res) => {
  const ip = getClientIP(req);
  const lockStatus = isIPLocked(ip);
  
  if (lockStatus.locked) {
    const remainingTime = formatRemainingTime(lockStatus.remainingTime);
    return res.json({
      locked: true,
      remainingTime,
      attempts: 10
    });
  }
  
  // 获取当前失败次数（从文件读取）
  const attemptsFile = path.join(__dirname, 'data', 'login-attempts.json');
  let attempts = 0;
  
  try {
    if (fs.existsSync(attemptsFile)) {
      const data = JSON.parse(fs.readFileSync(attemptsFile, 'utf-8'));
      if (data[ip]) {
        attempts = data[ip].failedCount || 0;
      }
    }
  } catch (error) {
    // 忽略错误
  }
  
  res.json({
    locked: false,
    attempts
  });
});

// 登录API
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const ip = getClientIP(req);
  
  console.log(`登录尝试 - IP: ${ip}, 用户名: ${username}`);
  
  // 检查IP是否被锁定
  const lockStatus = isIPLocked(ip);
  if (lockStatus.locked) {
    const remainingTime = formatRemainingTime(lockStatus.remainingTime);
    console.log(`登录拒绝 - IP ${ip} 已被锁定，剩余时间: ${remainingTime}`);
    return res.status(429).json({
      error: 'IP已被锁定',
      locked: true,
      remainingTime
    });
  }
  
  // 验证用户名和密码
  if (verifyCredentials(username, password)) {
    // 登录成功
    const token = generateSessionToken();
    sessions.set(token, {
      ip,
      username,
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    
    // 清除该IP的登录失败记录
    clearLoginAttempts(ip);
    
    console.log(`✓ 登录成功 - IP: ${ip}, 用户名: ${username}`);
    
    return res.json({
      success: true,
      token,
      message: '登录成功'
    });
  } else {
    // 登录失败
    const ipData = recordLoginFailure(ip);
    const remaining = 10 - ipData.failedCount;
    
    console.log(`✗ 登录失败 - IP: ${ip}, 剩余尝试次数: ${remaining}`);
    
    // 检查是否达到锁定阈值
    if (ipData.failedCount >= 10) {
      const lockStatus = isIPLocked(ip);
      const remainingTime = formatRemainingTime(lockStatus.remainingTime);
      
      return res.status(429).json({
        error: '登录失败次数过多，IP已被锁定',
        locked: true,
        remainingTime,
        attempts: 10
      });
    }
    
    return res.status(401).json({
      error: '用户名或密码错误',
      attempts: ipData.failedCount
    });
  }
});

// 登出API
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (token && sessions.has(token)) {
    sessions.delete(token);
    console.log('用户登出');
  }
  
  res.json({ success: true, message: '登出成功' });
});

// ==================== 配置管理API ====================

// 配置管理API - 获取配置
app.get('/api/config', requireAuth, (req, res) => {
  res.json(appConfig);
});

// 配置管理API - 保存配置
app.post('/api/config', requireAuth, (req, res) => {
  try {
    const newConfig = req.body;
    
    // 验证配置
    const validation = validateConfig(newConfig);
    if (!validation.valid) {
      return res.status(400).json({
        error: '配置验证失败',
        details: validation.errors
      });
    }
    
    // 保存配置
    if (saveConfig(newConfig)) {
      appConfig = newConfig;
      console.log('配置已更新');
      res.json({
        success: true,
        message: '配置保存成功'
      });
    } else {
      res.status(500).json({
        error: '保存配置失败'
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    available_configs: Object.keys(wireguardConfigs),
    configs: Object.keys(wireguardConfigs), // 保留旧字段以兼容
    configCount: Object.keys(wireguardConfigs).length,
    configUrls: appConfig.configUrls,
    wgProfiles: appConfig.wgProfiles
  });
});

// 重新加载配置端点
app.post('/reload', requireAuth, (req, res) => {
  try {
    loadConfigs();
    appConfig = loadConfig(); // 重新加载应用配置
    res.json({
      success: true,
      message: '配置已重新加载',
      configs: Object.keys(wireguardConfigs)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OpenWrt / 宿主机脚本：新增客户端（调用 add-client.sh）
app.post('/api/wg/add-client', requireAuth, (req, res) => {
  const name = req.body && req.body.name;
  if (!validateWgClientName(name)) {
    return res.status(400).json({
      success: false,
      error: '客户端名称无效（仅字母、数字、. _ -，长度 1～64）'
    });
  }
  runWgScript('add-client.sh', [name], res);
});

// 删除客户端（调用 delete-client.sh，脚本可后续自行替换）
app.post('/api/wg/delete-client', requireAuth, (req, res) => {
  const name = req.body && req.body.name;
  if (!validateWgClientName(name)) {
    return res.status(400).json({
      success: false,
      error: '客户端名称无效（仅字母、数字、. _ -，长度 1～64）'
    });
  }
  runWgScript('delete-client.sh', [name], res);
});

// Token管理API - 创建token
app.post('/api/tokens', requireAuth, (req, res) => {
  try {
    const { configName } = req.body;
    
    if (!configName) {
      return res.status(400).json({ error: '配置名称不能为空' });
    }
    
    // 检查配置是否存在
    if (!wireguardConfigs[configName]) {
      return res.status(404).json({ error: '配置不存在' });
    }
    
    const tokenObj = createToken(configName);
    
    if (!tokenObj) {
      return res.status(409).json({ 
        error: '该配置已有有效的订阅源',
        message: '请先失效现有订阅源后再创建新的'
      });
    }
    
    // 生成完整的订阅URL（新格式包含配置名称）
    const protocol = req.protocol;
    const host = req.get('host');
    const subscriptionUrl = `${protocol}://${host}/config/${configName}/${tokenObj.token}`;
    
    res.json({
      success: true,
      token: tokenObj.token,
      configName: tokenObj.configName,
      subscriptionUrl: subscriptionUrl,
      createdAt: tokenObj.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token管理API - 获取所有token
app.get('/api/tokens', requireAuth, (req, res) => {
  try {
    const tokens = getAllTokens();
    
    // 生成完整的订阅URL（新格式包含配置名称）
    const protocol = req.protocol;
    const host = req.get('host');
    
    const tokensWithUrl = tokens.map(t => ({
      ...t,
      subscriptionUrl: `${protocol}://${host}/config/${t.configName}/${t.token}`
    }));
    
    res.json(tokensWithUrl);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token管理API - 更新订阅合并选项（路由规则 / WireGuard）
app.patch('/api/tokens/:token', requireAuth, (req, res) => {
  try {
    const { token } = req.params;
    const body = req.body || {};
    const patch = {};
    if (typeof body.useRules === 'boolean') {
      patch.useRules = body.useRules;
    }
    if (typeof body.useWireGuard === 'boolean') {
      patch.useWireGuard = body.useWireGuard;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: '请提供 useRules 或 useWireGuard（布尔值）' });
    }
    const all = getAllTokens();
    const existing = all.find(t => t.token === token);
    if (!existing) {
      return res.status(404).json({ error: 'Token不存在' });
    }
    if (existing.active === false) {
      return res.status(400).json({ error: '已失效的订阅无法修改选项' });
    }
    const updated = updateTokenOptions(token, patch);
    if (!updated) {
      return res.status(500).json({ error: '更新失败' });
    }
    res.json({
      success: true,
      token: updated.token,
      configName: updated.configName,
      useRules: updated.useRules !== false,
      useWireGuard: updated.useWireGuard !== false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token管理API - 失效token
app.delete('/api/tokens/:token', requireAuth, (req, res) => {
  try {
    const { token } = req.params;
    
    const success = revokeToken(token);
    
    if (success) {
      res.json({
        success: true,
        message: 'Token已失效'
      });
    } else {
      res.status(404).json({
        error: 'Token不存在'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Token管理API - 删除失效token记录（彻底移除）
app.delete('/api/tokens/:token/remove', requireAuth, (req, res) => {
  try {
    const { token } = req.params;
    const all = getAllTokens();
    const tokenObj = all.find(t => t.token === token);
    if (!tokenObj) {
      return res.status(404).json({ error: 'Token不存在' });
    }
    if (tokenObj.active !== false) {
      return res.status(400).json({ error: '仅支持删除已失效的Token记录' });
    }
    const success = removeToken(token);
    if (success) {
      return res.json({ success: true, message: 'Token记录已删除' });
    }
    res.status(500).json({ error: '删除失败' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 订阅端点 - 通过token获取配置（新格式包含配置名称）
app.get('/config/:configName/:token', async (req, res) => {
  try {
    const { configName, token } = req.params;

    const tokenRecord = getTokenRecord(token);

    // 已从列表「删除记录」等：文件里无此 token——直接断开连接，不发送任何 HTTP 状态码与正文（不返回 404）
    if (!tokenRecord) {
      console.log(`⚠️ Token 不存在（已删除记录或从未存在） [${token}]: ${configName} → 关闭连接，无 HTTP 响应`);
      try {
        req.socket.destroy();
      } catch (e) {
        // ignore
      }
      return;
    }

    // 仅「失效」：记录仍在，返回 200 + 空模板，让客户端用本次拉取结果覆盖本地订阅文件
    if (tokenRecord.active === false) {
      console.log(`⚠️ Token 已失效 [${token}]: ${configName}，返回空配置模板（200）`);
      markBlankTemplateServedAfterRevoke(token);
      const emptyConfig = generateEmptyConfigTemplate();
      const yamlConfig = yaml.dump(emptyConfig, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      const comment =
        '# ⚠️ 此订阅链接已在管理端失效\n' +
        '# 以下为空白配置模板；客户端更新订阅时应以本内容覆盖本地配置文件，从而停用本订阅\n' +
        '# 如需继续使用，请在管理界面重新生成订阅链接\n\n';
      return res.type('text/yaml').send(comment + yamlConfig);
    }

    incrementTokenUsage(token);

    const tokenObj = tokenRecord;

    // 验证token对应的配置名称是否匹配URL中的配置名称
    if (tokenObj.configName !== configName) {
      console.log(`⚠️ Token配置不匹配 [${token}]: URL=${configName}, Token=${tokenObj.configName}，返回空配置模板`);
      
      const emptyConfig = generateEmptyConfigTemplate();
      const yamlConfig = yaml.dump(emptyConfig, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      
      const comment = `# ⚠️ 订阅链接配置不匹配\n# 请使用正确的订阅链接\n\n`;
      
      return res.type('text/yaml').send(comment + yamlConfig);
    }
    
    // 检查配置文件是否存在
    if (!wireguardConfigs[configName]) {
      console.log(`⚠️ 配置文件不存在 [${configName}]，返回空配置模板`);
      
      const emptyConfig = generateEmptyConfigTemplate();
      const yamlConfig = yaml.dump(emptyConfig, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      
      const comment = `# ⚠️ 配置文件不存在: ${configName}\n# 请确认配置文件是否已正确放置在 conf 目录\n\n`;
      
      return res.type('text/yaml').send(comment + yamlConfig);
    }
    
    console.log(`\n✓ 订阅请求 [${token}]: ${configName}`);

    const lastAttemptAt = Date.now();

    let fetchPack;
    try {
      fetchPack = await fetchAndMergeConfigs(appConfig.configUrls);
    } catch (err) {
      console.error('拉取远程订阅异常:', err.message);
      fetchPack = {
        config: createEmptyConfig(),
        subscriptionInfo: null,
        allSubscriptionInfos: [],
        remoteFetchOk: false
      };
    }

    const remoteFetchOk = fetchPack.remoteFetchOk === true;
    let baseConfig;
    let subscriptionInfo;
    let allSubscriptionInfos;
    let usedStaleRemote = false;
    let subscriptionDataUpdatedAt = null;

    if (remoteFetchOk) {
      baseConfig = fetchPack.config;
      subscriptionInfo = fetchPack.subscriptionInfo;
      allSubscriptionInfos = fetchPack.allSubscriptionInfos;
      subscriptionDataUpdatedAt = lastAttemptAt;
      // 仅缓存「远程订阅合并」结果，切勿改为 finalConfig：否则下次会从已含 WG/规则的底稿再注入，导致重复叠加
      writeRemoteCacheSuccess(appConfig.configUrls, {
        config: baseConfig,
        allSubscriptionInfos,
        subscriptionInfo,
        dataUpdatedAt: subscriptionDataUpdatedAt
      });
    } else {
      // stale.config 与成功拉取时写入的 baseConfig 同源；每次请求会在 appendMultipleWireGuardProfiles / baseConfigWithOptionalPrependRules 内深拷贝后再注入，不会越请求越叠
      const stale = readStaleRemoteCache(appConfig.configUrls);
      if (stale) {
        baseConfig = stale.config;
        subscriptionInfo = stale.subscriptionInfo;
        allSubscriptionInfos = stale.allSubscriptionInfos;
        subscriptionDataUpdatedAt = stale.dataUpdatedAt;
        usedStaleRemote = true;
        console.log('⚠️ 远程订阅全部拉取失败，使用上次成功缓存的合并结果');
      } else {
        baseConfig = fetchPack.config;
        subscriptionInfo = fetchPack.subscriptionInfo;
        allSubscriptionInfos = fetchPack.allSubscriptionInfos;
        subscriptionDataUpdatedAt = null;
      }
    }

    const useRules = tokenObj.useRules !== false;
    const useWireGuard = tokenObj.useWireGuard !== false;
    const prependRules = useRules ? (appConfig.prependRules || []) : [];

    function baseConfigWithOptionalPrependRules() {
      const cfg = JSON.parse(JSON.stringify(baseConfig));
      if (!cfg.rules) cfg.rules = [];
      if (prependRules.length) {
        cfg.rules.unshift(...prependRules);
      }
      return cfg;
    }

    const profile = Array.isArray(appConfig.wgProfiles) && appConfig.wgProfiles.length > 0
      ? appConfig.wgProfiles[0]
      : null;

    let finalConfig;
    if (!useWireGuard) {
      finalConfig = baseConfigWithOptionalPrependRules();
    } else if (!profile) {
      console.log(`⚠️ 未配置 WireGuard 参数（wgProfiles 为空），仅返回远程订阅合并结果`);
      finalConfig = baseConfigWithOptionalPrependRules();
    } else {
      const wg = wireguardConfigs[configName];
      if (!wg) {
        console.log(`⚠️ 找不到对应的 WireGuard 配置: ${configName}，仅返回远程订阅合并结果`);
        finalConfig = baseConfigWithOptionalPrependRules();
      } else {
        const dns = Array.isArray(profile.wgDns)
          ? profile.wgDns.map(d => String(d).trim()).filter(Boolean)
          : [];
        const dnsList = dns.length ? dns : ['8.8.8.8'];
        // 关键：节点名不能与代理组名同名，否则会出现 group 自引用（loop is detected）
        const existingProxyNames = new Set(
          Array.isArray(baseConfig.proxies)
            ? baseConfig.proxies.map(p => p && p.name).filter(Boolean)
            : []
        );
        const groupName = String(profile.wgGroupName || 'WireGuard');
        let wgProxyName = `${groupName} - WG`;
        let suffix = 2;
        while (existingProxyNames.has(wgProxyName) || wgProxyName === groupName) {
          wgProxyName = `${groupName} - WG ${suffix++}`;
        }
        const wgProxy = convertToClashProxy(
          wg,
          wgProxyName,
          profile.wgMtu,
          dnsList
        );
        const items = [{
          wgProxy,
          groupName,
          includeDirect: profile.includeDirect !== false
        }];
        finalConfig = appendMultipleWireGuardProfiles(
          baseConfig,
          items,
          prependRules
        );
      }
    }
    
    // 重新排序配置，确保基础配置在前
    finalConfig = reorderConfigKeys(finalConfig);
    
    // 设置订阅信息响应头（使用第一个订阅源）
    if (subscriptionInfo) {
      res.set('Subscription-Userinfo', formatSubscriptionHeader(subscriptionInfo));
    }
    
    // 返回 YAML 格式
    let yamlConfig = yaml.dump(finalConfig, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
    
    const infoComment = generateAllSubscriptionComment(allSubscriptionInfos, {
      remoteFetchOk,
      usedStaleRemote,
      subscriptionDataUpdatedAt,
      lastAttemptAt
    });
    yamlConfig = infoComment + yamlConfig;

    res.type('text/yaml').send(yamlConfig);
    
    console.log(`✓ 订阅成功: ${configName} (${token})\n`);
    
  } catch (error) {
    console.error('❌ 处理订阅请求时出错:', error);
    
    // 即使出错也返回空配置模板，确保客户端可以继续使用
    const emptyConfig = generateEmptyConfigTemplate();
    const yamlConfig = yaml.dump(emptyConfig, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
    
    const comment = `# ⚠️ 服务器错误: ${error.message}\n# 返回空配置模板，您之前的配置已缓存，可以继续使用\n\n`;
    
    res.type('text/yaml').send(comment + yamlConfig);
  }
});

// 根路径重定向到配置页面
app.get('/', (req, res) => {
  // 如果是API请求，返回JSON
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      message: 'WireGuard 配置合并服务',
      usage: '通过Web界面生成订阅token，然后访问 /config/:configName/:token 获取配置',
      available_configs: Object.keys(wireguardConfigs),
      endpoints: {
        webui: '/ (Web界面)',
        health: '/health',
        reload: '/reload (POST)',
        configApi: '/api/config (GET/POST)',
        tokenManagement: '/api/tokens (GET/POST/DELETE)',
        subscription: '/config/:configName/:token (订阅端点)'
      },
      config: {
        config_urls: appConfig.configUrls,
        conf_dir: CONF_DIR,
        wg_profiles: appConfig.wgProfiles
      }
    });
  }
  
  // 默认返回HTML配置页面
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log(`✓ 服务器已启动`);
  console.log(`✓ 监听端口: ${PORT}`);
  console.log(`✓ 可用配置: ${Object.keys(wireguardConfigs).length} 个`);
  console.log(`✓ Web管理界面: http://localhost:${PORT}`);
  console.log('\n当前配置:');
  console.log(`  - 订阅源: ${appConfig.configUrls.length > 0 ? appConfig.configUrls.length + ' 个' : '未配置'}`);
  console.log(`  - CONF_DIR: ${CONF_DIR}`);
  const wgN = Array.isArray(appConfig.wgProfiles) ? appConfig.wgProfiles.length : 0;
  console.log(`  - WireGuard 配置组: ${wgN} 组`);
  console.log('========================================\n');
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n收到 SIGINT 信号，正在关闭服务器...');
  process.exit(0);
});

