const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'data', 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  configUrls: [],
  wgMtu: 1340,
  wgDns: ['8.8.8.8'],
  wgGroupName: '🏠 Home',
  prependRules: [
    'IP-CIDR,192.168.0.0/16,🏠 Home',
    'IP-CIDR,10.0.0.0/8,🏠 Home',
    'DOMAIN-KEYWORD,local,🏠 Home'
  ]
};

/**
 * 确保配置文件目录存在
 */
function ensureConfigDir() {
  const configDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`创建配置目录: ${configDir}`);
  }
}

/**
 * 读取配置文件
 * @returns {object} 配置对象
 */
function loadConfig() {
  try {
    ensureConfigDir();
    
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(data);
      console.log('已加载配置文件');
      return config;
    } else {
      console.log('配置文件不存在，使用默认配置');
      saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    console.error('读取配置文件失败:', error.message);
    return DEFAULT_CONFIG;
  }
}

/**
 * 保存配置文件
 * @param {object} config - 配置对象
 * @returns {boolean} 是否保存成功
 */
function saveConfig(config) {
  try {
    ensureConfigDir();
    
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_FILE, data, 'utf-8');
    console.log('配置已保存');
    return true;
  } catch (error) {
    console.error('保存配置文件失败:', error.message);
    return false;
  }
}

/**
 * 验证配置
 * @param {object} config - 配置对象
 * @returns {object} { valid: boolean, errors: [] }
 */
function validateConfig(config) {
  const errors = [];
  
  // 验证 configUrls
  if (!Array.isArray(config.configUrls)) {
    errors.push('configUrls 必须是数组');
  }
  
  // 验证 wgMtu
  if (typeof config.wgMtu !== 'number' || config.wgMtu < 1 || config.wgMtu > 1500) {
    errors.push('wgMtu 必须是 1-1500 之间的数字');
  }
  
  // 验证 wgDns
  if (!Array.isArray(config.wgDns) || config.wgDns.length === 0) {
    errors.push('wgDns 必须是非空数组');
  }
  
  // 验证 wgGroupName
  if (typeof config.wgGroupName !== 'string' || config.wgGroupName.trim() === '') {
    errors.push('wgGroupName 不能为空');
  }
  
  // 验证 prependRules
  if (!Array.isArray(config.prependRules)) {
    errors.push('prependRules 必须是数组');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  validateConfig,
  DEFAULT_CONFIG
};

